import type { CloudProvider } from '../egress/egress'
import { type Header, readHeader, readHeaderPrefix } from '../export/container'
import {
  type DriveFolder,
  driveAccount,
  driveFolders,
  dropbox,
  googleDrive,
  SignInNeeded,
  type TokenSource,
} from './cloud'
import { README, ROTATIONS, rotationPlan, type Seen } from './naming'
import * as native from './native'

/**
 * Where backups go, behind one small interface: pick, remember, reconnect, read and write.
 *
 * Three kinds of place. In Chromium it is a folder from the File System Access directory picker. In
 * the phone apps it is whatever the system document picker handed the shell (`native.ts`) — a folder
 * where the provider offers one, or a single file where it does not; Hearth's own iCloud Drive
 * folder is one of these too — or a cloud drive the user signed in to (`cloud.ts`, ADR 0009). The remembered place lives in IndexedDB because a browser
 * handle cannot be stored in SQLite — the one piece of app state outside the database.
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

export type Place =
  | { kind: 'browser'; handle: FileSystemDirectoryHandle }
  | ({ kind: 'native' } & native.Location)
  | ({
      kind: 'cloud'
      provider: CloudProvider
      name: string
      /** The Drive folder the user chose; absent means a `Hearth` folder in My Drive. */
      folderId?: string
      /** Its path as the chooser showed it (`My Drive › Backups`), for display. */
      folderPath?: string
    } & native.CloudAccount)

/** Browses the signed-in Drive for the folder chooser; `withBackup` finds this profile's snapshot. */
function driveBrowser(token: TokenSource, snapshot: string) {
  const drive = driveFolders(token)
  return { ...drive, withBackup: () => drive.withBackup(snapshot) }
}
export type DriveBrowser = ReturnType<typeof driveBrowser>

/**
 * The card's folder chooser: the chosen folder and its path for display, or null to back out.
 * `account` is who just signed in.
 */
export type ChooseDriveFolder = (
  browser: DriveBrowser,
  account: string,
) => Promise<(DriveFolder & { path: string }) | null>

/** Places Hearth itself sends the copy to, rather than a folder the user manages and syncs. */
export const isCloud = (p: Place) => p.kind === 'cloud' || (p.kind === 'native' && p.ref === native.ICLOUD)

/** What the rest of the app reads and writes through; the kind of place is invisible past here. */
export interface Dir {
  readonly name: string
  /** A single file, not a folder: it holds the snapshot and nothing beside it. */
  readonly single: boolean
  /**
   * The provider keeps every earlier version itself (Drive, Dropbox), so no `.1`/`.2` copies: on a
   * cloud drive each one would be a download and an upload of the whole snapshot.
   */
  readonly versioned: boolean
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

const browserSupported = () =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

export const supported = () => browserSupported() || native.available()

/** What can be chosen here, best first. Only the phone apps offer cloud drives and single files. */
export const pickModes = async (): Promise<native.PickMode[]> =>
  native.available() ? native.modes() : browserSupported() ? ['folder'] : []

export const placeName = (p: Place) => (p.kind === 'browser' ? p.handle.name : p.name)

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

/** Records saved before phones had backups hold the browser handle at the top level. */
type Stored = Saved | (Omit<Saved, 'place'> & { handle: FileSystemDirectoryHandle })

export async function loadSaved(profile: string): Promise<Saved | null> {
  if (!supported()) return null
  try {
    const r = (await tx('readonly', (s) => s.get(profile))) as Stored | undefined
    if (!r) return null
    if ('place' in r) return r
    const { handle, ...rest } = r
    return { ...rest, place: { kind: 'browser', handle } }
  } catch {
    return null
  }
}

export async function save(profile: string, saved: Saved): Promise<void> {
  await tx('readwrite', (s) => s.put(saved, profile))
}

export async function forget(profile: string, place?: Place): Promise<void> {
  if (place) sessions.delete(place)
  if (place) await release(place)
  await tx('readwrite', (s) => s.delete(profile))
}

/** The same grant: the same picked item, or the same account at the same provider. */
export function samePlace(a: Place, b: Place): boolean {
  if (a.kind === 'native' && b.kind === 'native') return a.ref === b.ref
  if (a.kind === 'cloud' && b.kind === 'cloud') return a.provider === b.provider && a.account === b.account
  return false
}

/**
 * Hands a native grant back to the system, or signs out of a cloud drive; a browser handle simply
 * stops being remembered.
 */
export async function release(place: Place): Promise<void> {
  if (place.kind === 'native') await native.release(place)
  if (place.kind === 'cloud') await native.cloudSignOut(place.provider, place.account)
}

// ---- picking and permissions ---------------------------------------------------------------

const CLOUD_NAMES: Record<CloudProvider, string> = { google: 'Google Drive', dropbox: 'Dropbox' }

/** Opens the picker, or the provider's sign-in; null when the user backed out. Must run from a click. */
export async function pick(
  mode: native.PickMode,
  suggested: string,
  chooseDriveFolder?: ChooseDriveFolder,
): Promise<Place | null> {
  if (mode === 'google' || mode === 'dropbox') {
    const signed = await native.cloudSignIn(mode)
    if (!signed) return null
    const place: CloudPlace = {
      kind: 'cloud',
      provider: mode,
      account: signed.account,
      label: signed.label,
      name: `${CLOUD_NAMES[mode]} (${signed.label})`,
    }
    if (mode === 'google' && !place.account) {
      // Play services does not always say who signed in; Drive does. The account is how the shell
      // finds the grant again for every later token, so it must not stay empty.
      place.account = await driveAccount(async () => signed.token)
      place.label = place.account
      place.name = `${CLOUD_NAMES[mode]} (${place.label})`
      if (!place.account) throw new Error('Google Drive did not say which account signed in')
    }
    if (mode === 'google' && chooseDriveFolder) {
      const folder = await chooseDriveFolder(
        driveBrowser(tokenSource(place, signed.token), suggested),
        place.account,
      )
      if (!folder) return null
      place.folderId = folder.id
      place.folderPath = folder.path
      place.name = `${CLOUD_NAMES[mode]} › ${folder.path}`
    }
    sessions.set(place, cloudSession(place, signed.token))
    return place
  }
  if (native.available()) {
    const loc = await native.pick(mode, suggested)
    return loc && { kind: 'native', ...loc }
  }
  if (!window.showDirectoryPicker) throw new Error('folder access is not available in this browser')
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'hearth-backup' })
    return { kind: 'browser', handle }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

/**
 * Whether the place can be used right now. A native grant that iOS refreshed comes back with a new
 * ref, written into `place` so the next save keeps it.
 */
export async function permission(place: Place): Promise<'granted' | 'prompt'> {
  if (place.kind === 'cloud') {
    try {
      await session(place).token(false)
      return 'granted'
    } catch (e) {
      if (e instanceof SignInNeeded) return 'prompt'
      throw e
    }
  }
  if (place.kind === 'browser')
    return (await (place.handle as Handle).queryPermission({ mode: 'readwrite' })) === 'granted'
      ? 'granted'
      : 'prompt'
  const s = await native.status(place)
  place.ref = s.ref
  return s.granted ? 'granted' : 'prompt'
}

/**
 * Must be called from a user gesture. The browser can simply ask again; a native grant that is gone
 * (the file was deleted, the provider's app removed) can only be replaced by picking again.
 */
export async function reconnect(
  place: Place,
  suggested: string,
  chooseDriveFolder?: ChooseDriveFolder,
): Promise<Place | null> {
  if (place.kind === 'browser')
    return (await (place.handle as Handle).requestPermission({ mode: 'readwrite' })) === 'granted'
      ? place
      : null
  if (place.kind === 'cloud') {
    // Signing back in to the same account keeps its folder; another account chooses anew.
    const { folderId, folderPath } = place
    // A place from before folders could be chosen keeps its default `Hearth` folder.
    if (!folderId) return pick(place.provider, suggested)
    return pick(place.provider, suggested, async (browser, account) =>
      account === place.account
        ? { id: folderId, name: folderPath ?? '', path: folderPath ?? '' }
        : (chooseDriveFolder?.(browser, account) ?? null),
    )
  }
  if (place.ref === native.ICLOUD) return pick('icloud', suggested)
  return pick(place.single ? 'existingFile' : 'folder', suggested)
}

// ---- files ----------------------------------------------------------------------------------

// ---- cloud sessions -------------------------------------------------------------------------

interface Session {
  token(fresh: boolean): Promise<string>
  dir: Dir
}

/**
 * One per signed-in place for the page's lifetime: the cached access token, and the Dir, which
 * remembers the provider's folder ids so a backup does not look them up again every time.
 */
const sessions = new WeakMap<Place, Session>()

type CloudPlace = Extract<Place, { kind: 'cloud' }>

/** Access tokens from the shell, cached until the provider refuses one. */
function tokenSource(place: CloudPlace, first: string | null) {
  let cached = first
  return async (fresh: boolean) => {
    if (fresh || !cached)
      cached = await native.cloudToken(place.provider, place.account, fresh ? cached : null)
    if (!cached) throw new SignInNeeded(place.provider)
    return cached
  }
}

function cloudSession(place: CloudPlace, first: string | null): Session {
  const token = tokenSource(place, first)
  const dir =
    place.provider === 'google' ? googleDrive(token, place.name, place.folderId) : dropbox(token, place.name)
  return { token, dir }
}

function session(place: Extract<Place, { kind: 'cloud' }>): Session {
  let s = sessions.get(place)
  if (!s) {
    s = cloudSession(place, null)
    sessions.set(place, s)
  }
  return s
}

export function open(place: Place, snapshot: string): Dir {
  if (place.kind === 'browser') return browserDir(place.handle)
  if (place.kind === 'cloud') return session(place).dir
  return place.single ? nativeFile(place, snapshot) : nativeDir(place.ref, place.name, [])
}

function browserDir(dir: FileSystemDirectoryHandle): Dir {
  return {
    name: dir.name,
    single: false,
    versioned: false,
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

const utf8 = (bytes: Uint8Array | string) =>
  typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes

function nativeDir(ref: string, name: string, path: string[]): Dir {
  return {
    name,
    single: false,
    versioned: false,
    names: () => native.list(ref, path),
    read: (file) => native.read({ ref, path, name: file }).catch(() => null),
    readHead: (file, bytes) => native.readHead({ ref, path, name: file }, bytes).catch(() => null),
    write: (file, bytes) => native.write({ ref, path, name: file }, utf8(bytes)),
    remove: (file) => native.remove({ ref, path, name: file }).then(() => {}),
    async subdir(sub, create = false) {
      return (await native.mkdir(ref, path, sub, create)) ? nativeDir(ref, sub, [...path, sub]) : null
    },
  }
}

/**
 * One picked file, seen as a folder that holds the snapshot and nothing else. Every other name is
 * refused rather than mapped onto the file: writing a rotation or a README there would overwrite
 * the backup.
 */
function nativeFile(loc: native.Location, snapshot: string): Dir {
  const self = { ref: loc.ref, path: [], name: null }
  const only = (name: string) => {
    if (name !== snapshot) throw new Error(`${loc.name} is a single file and holds only the snapshot`)
  }
  return {
    name: loc.name,
    single: true,
    versioned: false,
    names: async () => [snapshot],
    read: async (name) => (name === snapshot ? native.read(self).catch(() => null) : null),
    readHead: async (name, bytes) =>
      name === snapshot ? native.readHead(self, bytes).catch(() => null) : null,
    async write(name, bytes) {
      only(name)
      await native.write(self, utf8(bytes))
    },
    async remove(name) {
      only(name)
      await native.remove(self)
    },
    subdir: async () => null,
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
 * portably), then writes the new one over `base`. A crash mid-write leaves `base.1` intact. A single
 * file has nowhere to rotate to; the provider's own version history is its only older copy.
 */
export async function writeSnapshot(
  dir: Dir,
  base: string,
  bytes: Uint8Array,
  appUrl: string,
): Promise<void> {
  if (dir.single) return dir.write(base, bytes)
  const have = await dir.names()
  const rotations = dir.versioned ? [] : rotationPlan(have, base, ROTATIONS)
  for (const { from, to } of rotations) {
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
