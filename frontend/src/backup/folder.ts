import { type Header, readHeader } from '../export/container'
import { README, ROTATIONS, rotationPlan, type Seen } from './naming'

/**
 * The File System Access side of the backup folder: pick, remember, reconnect, read and write.
 * Chromium-only; `supported()` gates the UI. The remembered handle lives in IndexedDB because a
 * handle cannot be stored in SQLite — the one piece of app state outside the database.
 */

// The picker and permission methods are not in TypeScript's DOM lib yet.
type Permission = 'granted' | 'denied' | 'prompt'
interface Dir extends FileSystemDirectoryHandle {
  queryPermission(d: { mode: 'readwrite' }): Promise<Permission>
  requestPermission(d: { mode: 'readwrite' }): Promise<Permission>
}
declare global {
  interface Window {
    showDirectoryPicker?(o: { mode: 'readwrite'; id?: string }): Promise<FileSystemDirectoryHandle>
  }
}

export const supported = () =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

export interface Saved {
  handle: Dir
  /** Header of the snapshot last written to or loaded from this folder by this browser. */
  lastSeen: Seen | null
  /** The user chose to store without a passphrase. */
  plain: boolean
}

// ---- remembered handle (IndexedDB) ---------------------------------------------------------

const IDB = 'hearth-handles'
const STORE = 'folders'

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export async function loadSaved(profile: string): Promise<Saved | null> {
  if (!supported()) return null
  try {
    return ((await tx('readonly', (s) => s.get(profile))) as Saved | undefined) ?? null
  } catch {
    return null
  }
}

export async function save(profile: string, saved: Saved): Promise<void> {
  await tx('readwrite', (s) => s.put(saved, profile))
}

export async function forget(profile: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(profile))
}

// ---- permissions ----------------------------------------------------------------------------

export async function pick(): Promise<Dir> {
  if (!window.showDirectoryPicker) throw new Error('folder access is not available in this browser')
  return (await window.showDirectoryPicker({ mode: 'readwrite', id: 'hearth-backup' })) as Dir
}

export const permission = (dir: Dir) => dir.queryPermission({ mode: 'readwrite' })

/** Must be called from a user gesture. */
export const reconnect = async (dir: Dir) =>
  (await dir.requestPermission({ mode: 'readwrite' })) === 'granted'

// ---- files ----------------------------------------------------------------------------------

async function names(dir: Dir): Promise<string[]> {
  const out: string[] = []
  for await (const name of dir.keys()) out.push(name)
  return out
}

async function readFile(dir: Dir, name: string): Promise<Uint8Array | null> {
  try {
    const f = await (await dir.getFileHandle(name)).getFile()
    return new Uint8Array(await f.arrayBuffer())
  } catch {
    return null
  }
}

async function writeFile(dir: Dir, name: string, bytes: Uint8Array | string): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
  try {
    await w.write(bytes as BlobPart)
  } finally {
    await w.close()
  }
}

/** Header of the current snapshot in the folder; null when there is none or it is unreadable. */
export async function currentHeader(dir: Dir, base: string): Promise<Header | null> {
  const bytes = await readFile(dir, base)
  if (!bytes) return null
  try {
    return readHeader(bytes)
  } catch {
    return null
  }
}

export const readCurrent = (dir: Dir, base: string) => readFile(dir, base)

/**
 * Rotates the previous snapshots by copying (handles on removable media cannot be renamed
 * portably), then writes the new one over `base`. A crash mid-write leaves `base.1` intact.
 */
export async function writeSnapshot(
  dir: Dir,
  base: string,
  bytes: Uint8Array,
  appUrl: string,
): Promise<void> {
  const have = await names(dir)
  for (const { from, to } of rotationPlan(have, base, ROTATIONS)) {
    const data = await readFile(dir, from)
    if (data) await writeFile(dir, to, data)
  }
  await writeFile(dir, base, bytes)
  if (!have.includes('README.txt')) await writeFile(dir, 'README.txt', README(appUrl))
}

export const writeConflict = (dir: Dir, name: string, bytes: Uint8Array) => writeFile(dir, name, bytes)

/** Best effort: removes every snapshot of this profile (revoke = delete). */
export async function deleteSnapshots(dir: Dir, base: string): Promise<number> {
  let n = 0
  for (const name of await names(dir)) {
    if (
      name === base ||
      name.startsWith(`${base}.`) ||
      name.startsWith(base.replace(/\.hearth$/, '.conflict-'))
    ) {
      await dir.removeEntry(name).catch(() => {})
      n++
    }
  }
  return n
}
