import { mirrorAttachments, pullAttachments } from '../attachments/mirror'
import { missingLocally } from '../attachments/store'
import { Database } from '../db/db'
import { countAttachments, getMeta } from '../db/repo'
import { type Progress, type RestoreResult, restoreBytes } from '../export/restore'
import { snapshotBytes } from '../export/snapshot'
import * as folder from './folder'
import { attachmentsDirName, baseName, conflictName, hasNewer, isForeign } from './naming'

/**
 * App-wide backup state: the remembered folder, the session passphrase, a debounced autosave
 * after every write, and the conflict rule. One instance per page; the Settings card renders
 * whatever `status` says and calls the actions.
 */
export type Status =
  | { state: 'unsupported' }
  | { state: 'none' }
  | { state: 'reconnect'; name: string }
  | { state: 'needs-passphrase'; name: string }
  | {
      state: 'ready'
      name: string
      /** An automatic backup is scheduled. */
      pending: boolean
      /** This browser has changes the folder does not have yet. */
      dirty: boolean
      lastAt: string | null
      newer: boolean
      /** Attached documents this browser has not copied to the folder yet. */
      attachmentsPending: number
      /** Attached documents this browser has a row for but not the bytes. */
      attachmentsMissing: number
    }
  | { state: 'writing'; name: string; step: 'loading' | 'building' | 'writing' | 'attachments' }
  | { state: 'conflict'; name: string; file: string }
  | { state: 'error'; name: string; message: string }

const DEBOUNCE_MS = 5000
/** A folder on a stuck network or cloud mount can hang every file call; never wait on it forever. */
const FOLDER_TIMEOUT_MS = 10_000

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not respond within ${ms / 1000} s`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
const PASS_KEY = (profile: string) => `hearth:${profile}:backup-pass`

class Backups {
  private db!: Database
  private appVersion = ''
  private profile = 'default'
  private saved: folder.Saved | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private newer = false
  private busy = false
  private readonly listeners = new Set<() => void>()
  status: Status = { state: 'none' }

  async start(db: Database, appVersion: string): Promise<void> {
    this.db = db
    this.appVersion = appVersion
    this.profile = Database.profile()
    if (!folder.supported()) return this.set({ state: 'unsupported' })
    this.saved = await folder.loadSaved(this.profile)
    db.onChange(() => this.request())
    // Reading the folder can be slow (a cloud mount) or hang; startup must not wait for it.
    void this.refresh()
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private set(s: Status) {
    this.status = s
    for (const l of this.listeners) l()
  }

  get name(): string {
    return this.saved?.handle.name ?? ''
  }

  get plain(): boolean {
    return this.saved?.plain ?? false
  }

  get auto(): boolean {
    return this.saved?.auto ?? true
  }

  async setAuto(auto: boolean): Promise<void> {
    if (!this.saved) return
    this.saved.auto = auto
    await folder.save(this.profile, this.saved)
    if (auto) this.request()
    else this.cancelPending()
    await this.refresh()
  }

  private cancelPending(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  passphrase(): string {
    try {
      return sessionStorage.getItem(PASS_KEY(this.profile)) ?? ''
    } catch {
      return ''
    }
  }

  setPassphrase(p: string): void {
    try {
      if (p) sessionStorage.setItem(PASS_KEY(this.profile), p)
      else sessionStorage.removeItem(PASS_KEY(this.profile))
    } catch {}
    void this.refresh()
  }

  async setPlain(plain: boolean): Promise<void> {
    if (!this.saved) return
    this.saved.plain = plain
    await folder.save(this.profile, this.saved)
    await this.refresh()
  }

  /** Re-derives the status from the folder (permission, newer snapshot). */
  async refresh(): Promise<void> {
    if (!this.saved) return this.set({ state: 'none' })
    const name = this.name
    if ((await folder.permission(this.saved.handle)) !== 'granted')
      return this.set({ state: 'reconnect', name })
    if (!this.plain && !this.passphrase()) return this.set({ state: 'needs-passphrase', name })
    const device = (await getMeta(this.db, 'device')) ?? ''
    let current: Awaited<ReturnType<typeof folder.currentHeader>>
    try {
      current = await withTimeout(
        folder.currentHeader(this.saved.handle, baseName(this.profile)),
        FOLDER_TIMEOUT_MS,
        name,
      )
    } catch (e) {
      return this.set({ state: 'error', name, message: e instanceof Error ? e.message : String(e) })
    }
    this.newer = hasNewer(current, device, this.saved.lastSeen)
    const dirty = await this.dirty(device)
    // Counted from the database, never by listing the folder: refresh runs often and a cloud
    // mount is slow enough that a scan here would stall the whole card.
    const blobs = (await countAttachments(this.db)).blobs
    this.set({
      state: 'ready',
      name,
      pending: this.timer !== null,
      dirty,
      lastAt: this.saved.lastAt ?? null,
      newer: this.newer,
      attachmentsPending: Math.max(0, blobs - (this.saved.mirrored ?? 0)),
      attachmentsMissing: (await missingLocally(this.db)).length,
    })
    // Changes made while the folder was unreachable (or before a reload) go out without waiting
    // for the next edit. A newer copy from another computer is left for the user to pull in.
    if (dirty && this.auto && !this.newer && !this.timer && !this.busy) this.request()
  }

  /** Whether the database changed since this browser last wrote to or loaded from the folder. */
  private async dirty(device: string): Promise<boolean> {
    const seen = this.saved?.lastSeen
    const generation = Number((await getMeta(this.db, 'generation')) ?? 0)
    return !seen || seen.device !== device || generation > seen.generation
  }

  /** Choose (or replace) the folder. Must run from a click. */
  async choose(): Promise<void> {
    const handle = await folder.pick()
    this.saved = { handle, lastSeen: null, plain: false, auto: true }
    await folder.save(this.profile, this.saved)
    await this.refresh()
  }

  async reconnect(): Promise<void> {
    if (this.saved && (await folder.reconnect(this.saved.handle))) await this.refresh()
  }

  /** Forgets the folder and, if asked, deletes the snapshots in it. */
  async forget(deleteFiles: boolean): Promise<{ snapshots: number; attachments: number }> {
    let n = 0
    let files = 0
    if (this.saved && deleteFiles) {
      n = await folder.deleteSnapshots(this.saved.handle, baseName(this.profile))
      files = await folder.removeDir(this.saved.handle, attachmentsDirName(this.profile))
    }
    this.saved = null
    await folder.forget(this.profile)
    this.setPassphrase('')
    this.set({ state: 'none' })
    return { snapshots: n, attachments: files }
  }

  /**
   * A change happened. With automatic sync on, a backup follows after a quiet period (debounced so
   * a burst of writes, like an import, produces one snapshot); with it off, the header just shows
   * that there are unsynced changes.
   */
  request(): void {
    if (!this.saved || this.status.state === 'unsupported' || this.status.state === 'none') return
    if (!this.auto) {
      if (this.status.state === 'ready') this.set({ ...this.status, dirty: true })
      return
    }
    this.cancelPending()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.backupNow()
    }, DEBOUNCE_MS)
    if (this.status.state === 'ready') this.set({ ...this.status, pending: true, dirty: true })
  }

  /**
   * The header's Sync button: bring in a newer snapshot from another computer first (a union, so
   * nothing here is lost), then write this browser's state to the folder.
   */
  async sync(onProgress: Progress = () => {}): Promise<void> {
    if (this.busy) return
    this.cancelPending()
    if (this.status.state === 'ready' && this.status.newer) {
      this.set({ state: 'writing', name: this.name, step: 'loading' })
      try {
        await this.loadFromFolder(onProgress)
      } catch (e) {
        return this.set({
          state: 'error',
          name: this.name,
          message: e instanceof Error ? e.message : String(e),
        })
      }
      this.cancelPending()
    }
    await this.backupNow()
  }

  /** Writes a snapshot now, unless another browser's unseen snapshot is in the way. */
  async backupNow(force = false): Promise<void> {
    if (!this.saved || this.busy) return
    this.cancelPending()
    const name = this.name
    if ((await folder.permission(this.saved.handle)) !== 'granted')
      return this.set({ state: 'reconnect', name })
    const pass = this.passphrase()
    if (!this.plain && !pass) return this.set({ state: 'needs-passphrase', name })
    this.busy = true
    this.set({ state: 'writing', name, step: 'building' })
    try {
      const base = baseName(this.profile)
      const device = (await getMeta(this.db, 'device')) ?? ''
      const bytes = await snapshotBytes(this.db, this.appVersion, this.plain ? undefined : pass)
      this.set({ state: 'writing', name, step: 'writing' })
      const current = await folder.currentHeader(this.saved.handle, base)
      if (!force && isForeign(current, device, this.saved.lastSeen)) {
        const file = conflictName(base, device, new Date().toISOString())
        await folder.writeConflict(this.saved.handle, file, bytes)
        // The conflict snapshot refers to these documents too, and a sidecar cannot conflict:
        // two computers writing the same name write the same bytes.
        await this.mirror()
        return this.set({ state: 'conflict', name, file })
      }
      await folder.writeSnapshot(this.saved.handle, base, bytes, location.origin)
      this.saved.lastSeen = { device, generation: Number((await getMeta(this.db, 'generation')) ?? 0) }
      this.saved.lastAt = new Date().toISOString()
      await folder.save(this.profile, this.saved)
      this.set({ state: 'writing', name, step: 'attachments' })
      await this.mirror()
      await this.refresh()
    } catch (e) {
      this.set({ state: 'error', name, message: e instanceof Error ? e.message : String(e) })
    } finally {
      this.busy = false
    }
  }

  /**
   * Copies documents the folder does not have yet. Deliberately not fatal: the journal is already
   * written by this point, and a folder that refuses a file must not cost the user the snapshot.
   */
  private async mirror(): Promise<void> {
    if (!this.saved) return
    try {
      const r = await withTimeout(
        mirrorAttachments(this.saved.handle, this.db, this.profile, this.plain ? null : this.passphrase()),
        FOLDER_TIMEOUT_MS,
        this.name,
      )
      const sub = await folder.subdir(this.saved.handle, attachmentsDirName(this.profile))
      this.saved.mirrored = sub ? (await folder.listNames(sub)).length : r.written
      await folder.save(this.profile, this.saved)
    } catch {
      // Left for the next backup; `attachmentsPending` keeps saying there is work to do.
    }
  }

  /** Fetches documents this browser has rows for but not bytes (after restoring on a new PC). */
  async pullNow(): Promise<{ pulled: number; missing: number }> {
    if (!this.saved) return { pulled: 0, missing: 0 }
    const r = await pullAttachments(
      this.saved.handle,
      this.db,
      this.profile,
      this.plain ? null : this.passphrase(),
    )
    await this.refresh()
    return r
  }

  /** Loads the folder's current snapshot into this browser (union by id, see restore.ts). */
  async loadFromFolder(onProgress: Progress): Promise<RestoreResult> {
    if (!this.saved) throw new Error('no folder chosen')
    const base = baseName(this.profile)
    const bytes = await folder.readCurrent(this.saved.handle, base)
    if (!bytes) throw new Error(`no ${base} in ${this.name}`)
    const r = await restoreBytes(
      this.db,
      bytes,
      this.plain ? undefined : this.passphrase() || undefined,
      onProgress,
    )
    onProgress('restore.pullingAttachments')
    await pullAttachments(this.saved.handle, this.db, this.profile, this.plain ? null : this.passphrase())
    const header = await folder.currentHeader(this.saved.handle, base)
    if (header) this.saved.lastSeen = { device: header.device, generation: header.generation }
    await folder.save(this.profile, this.saved)
    // The restore itself scheduled an autosave; that snapshot will carry the union.
    await this.refresh()
    return r
  }
}

export const backups = new Backups()
