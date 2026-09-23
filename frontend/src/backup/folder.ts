import { type Header, readHeader, readHeaderPrefix } from '../export/container'
import { README, ROTATIONS, rotationPlan, type Seen } from './naming'

/**
 * Where backups go, behind one small interface: pick, remember, reconnect, read and write.
 *
 * The place is a folder from the File System Access directory picker (Chromium). The phone apps
 * are native and keep their own backup places (ADR 0010). The remembered place lives in IndexedDB
 * because a browser handle cannot be stored in SQLite — the one piece of app state outside the
 * database.
 */

// The picker and permission methods are not in TypeScript's DOM lib yet.
type Permission = 'granted' | 'denied' | 'prompt'
interface Handle extends FileSystemDirectoryHandle {
  queryPermission(d: { mode: 'readwrite' }): Promise<Permission>
  requestPermission(d: { mode: 'readwrite' }): Promise<Permission>
}
declare global {
  interface Window {
    showDirectoryPicker?(o: { mode: 'readwrite'; id?: string }): Promise<FileSystemDirectoryHandle>
  }
}

export type Place = { kind: 'browser'; handle: FileSystemDirectoryHandle }

/** What the rest of the app reads and writes through; the handle is invisible past here. */
export interface Dir {
  readonly name: string
  names(): Promise<string[]>
  read(name: string): Promise<Uint8Array | null>
  /** The first `bytes` of a file (or all of a shorter one); null when it is not there. */
  readHead(name: string, bytes: number): Promise<Uint8Array | null>
  write(name: string, bytes: Uint8Array | string): Promise<void>
  /** Removes a file or a whole folder. */
  remove(name: string): Promise<void>
  /** A subfolder, or null when it is not there and we are not creating it. */
  subdir(name: string, create?: boolean): Promise<Dir | null>
}

export const supported = () =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

export const placeName = (p: Place) => p.handle.name

export interface Saved {
  place: Place
  /** Header of the snapshot last written to or loaded from this place by this browser. */
  lastSeen: Seen | null
  /** The user chose to store without a passphrase. */
  plain: boolean
  /** Back up automatically after every change; absent in places saved before the switch existed. */
  auto?: boolean
  /** When this browser last wrote a snapshot to the place (ISO). */
  lastAt?: string
  /** How many attachment sidecars the folder held after the last successful mirror. */
  mirrored?: number
}

// ---- remembered place (IndexedDB) ----------------------------------------------------------

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

/**
 * Records saved before phones had backups hold the browser handle at the top level; records from
 * the old phone shells hold another kind of place, which a browser cannot open.
 */
type Stored =
  | (Omit<Saved, 'place'> & { place: { kind: string } })
  | (Omit<Saved, 'place'> & { handle: FileSystemDirectoryHandle })

export async function loadSaved(profile: string): Promise<Saved | null> {
  if (!supported()) return null
  try {
    const r = (await tx('readonly', (s) => s.get(profile))) as Stored | undefined
    if (!r) return null
    if ('place' in r) return r.place.kind === 'browser' ? (r as Saved) : null
    const { handle, ...rest } = r
    return { ...rest, place: { kind: 'browser', handle } }
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

// ---- picking and permissions ---------------------------------------------------------------

/** Opens the folder picker; null when the user backed out. Must run from a click. */
export async function pick(): Promise<Place | null> {
  if (!window.showDirectoryPicker) throw new Error('folder access is not available in this browser')
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'hearth-backup' })
    return { kind: 'browser', handle }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

/** Whether the place can be used right now. */
export async function permission(place: Place): Promise<'granted' | 'prompt'> {
  return (await (place.handle as Handle).queryPermission({ mode: 'readwrite' })) === 'granted'
    ? 'granted'
    : 'prompt'
}

/** Asks the browser for access again; null when refused. Must be called from a user gesture. */
export async function reconnect(place: Place): Promise<Place | null> {
  return (await (place.handle as Handle).requestPermission({ mode: 'readwrite' })) === 'granted'
    ? place
    : null
}

// ---- files ----------------------------------------------------------------------------------

export const open = (place: Place): Dir => browserDir(place.handle)

function browserDir(dir: FileSystemDirectoryHandle): Dir {
  return {
    name: dir.name,
    async names() {
      const out: string[] = []
      for await (const name of dir.keys()) out.push(name)
      return out
    },
    async read(name) {
      try {
        const f = await (await dir.getFileHandle(name)).getFile()
        return new Uint8Array(await f.arrayBuffer())
      } catch {
        return null
      }
    },
    async readHead(name, bytes) {
      try {
        const f = await (await dir.getFileHandle(name)).getFile()
        return new Uint8Array(await f.slice(0, bytes).arrayBuffer())
      } catch {
        return null
      }
    },
    async write(name, bytes) {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      try {
        await w.write(bytes as BlobPart)
      } finally {
        await w.close()
      }
    },
    remove: (name) => dir.removeEntry(name, { recursive: true }).catch(() => {}),
    async subdir(name, create = false) {
      try {
        return browserDir(await dir.getDirectoryHandle(name, { create }))
      } catch {
        return null
      }
    },
  }
}

export async function removeDir(dir: Dir, name: string): Promise<number> {
  const sub = await dir.subdir(name)
  if (!sub) return 0
  const n = (await sub.names()).length
  await dir.remove(name).catch(() => {})
  return n
}

/** Enough for any header Hearth writes; the rest of the snapshot stays where it is. */
const HEAD_BYTES = 64 * 1024

/**
 * Header of the current snapshot in the folder; null when there is none or it is unreadable. Reads
 * only the file's first bytes when they settle it, which they do for everything Hearth writes.
 */
export async function currentHeader(dir: Dir, base: string): Promise<Header | null> {
  const head = await dir.readHead(base, HEAD_BYTES)
  if (!head) return null
  try {
    const fromPrefix = readHeaderPrefix(head)
    if (fromPrefix !== undefined) return fromPrefix
    const bytes = head.length < HEAD_BYTES ? head : await dir.read(base)
    return bytes ? readHeader(bytes) : null
  } catch {
    return null
  }
}

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
  const have = await dir.names()
  for (const { from, to } of rotationPlan(have, base, ROTATIONS)) {
    const data = await dir.read(from)
    if (data) await dir.write(to, data)
  }
  await dir.write(base, bytes)
  if (!have.includes('README.txt')) await dir.write('README.txt', README(appUrl))
}

/**
 * Best effort: removes every snapshot of this profile (revoke = delete), including the conflict
 * copies earlier versions wrote beside it.
 */
export async function deleteSnapshots(dir: Dir, base: string): Promise<number> {
  let n = 0
  for (const name of await dir.names()) {
    if (
      name === base ||
      name.startsWith(`${base}.`) ||
      name.startsWith(base.replace(/\.hearth$/, '.conflict-'))
    ) {
      await dir.remove(name).catch(() => {})
      n++
    }
  }
  return n
}
