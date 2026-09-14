import { Database } from '../db/db'
import { getMeta } from '../db/repo'
import { restoreBytes } from '../export/restore'
import { snapshotBytes } from '../export/snapshot'
import * as folder from './folder'
import { baseName, conflictName, hasNewer, isForeign } from './naming'

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
  | { state: 'ready'; name: string; pending: boolean; lastAt: string | null; newer: boolean }
  | { state: 'writing'; name: string }
  | { state: 'conflict'; name: string; file: string }
  | { state: 'error'; name: string; message: string }

const DEBOUNCE_MS = 5000
const PASS_KEY = (profile: string) => `hearth:${profile}:backup-pass`

class Backups {
  private db!: Database
  private appVersion = ''
  private profile = 'default'
  private saved: folder.Saved | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastAt: string | null = null
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
    await this.refresh()
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
    const current = await folder.currentHeader(this.saved.handle, baseName(this.profile))
    this.newer = hasNewer(current, device, this.saved.lastSeen)
    this.set({ state: 'ready', name, pending: this.timer !== null, lastAt: this.lastAt, newer: this.newer })
  }

  /** Choose (or replace) the folder. Must run from a click. */
  async choose(): Promise<void> {
    const handle = await folder.pick()
    this.saved = { handle, lastSeen: null, plain: false }
    await folder.save(this.profile, this.saved)
    await this.refresh()
  }

  async reconnect(): Promise<void> {
    if (this.saved && (await folder.reconnect(this.saved.handle))) await this.refresh()
  }

  /** Forgets the folder and, if asked, deletes the snapshots in it. */
  async forget(deleteFiles: boolean): Promise<number> {
    let n = 0
    if (this.saved && deleteFiles) n = await folder.deleteSnapshots(this.saved.handle, baseName(this.profile))
    this.saved = null
    await folder.forget(this.profile)
    this.setPassphrase('')
    this.set({ state: 'none' })
    return n
  }

  /** Autosave: debounced so a burst of writes (an import) produces one snapshot. */
  request(): void {
    if (!this.saved || this.status.state === 'unsupported' || this.status.state === 'none') return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.backupNow()
    }, DEBOUNCE_MS)
    if (this.status.state === 'ready') this.set({ ...this.status, pending: true })
  }

  /** Writes a snapshot now, unless another browser's unseen snapshot is in the way. */
  async backupNow(force = false): Promise<void> {
    if (!this.saved || this.busy) return
    const name = this.name
    if ((await folder.permission(this.saved.handle)) !== 'granted')
      return this.set({ state: 'reconnect', name })
    const pass = this.passphrase()
    if (!this.plain && !pass) return this.set({ state: 'needs-passphrase', name })
    this.busy = true
    this.set({ state: 'writing', name })
    try {
      const base = baseName(this.profile)
      const device = (await getMeta(this.db, 'device')) ?? ''
      const bytes = await snapshotBytes(this.db, this.appVersion, this.plain ? undefined : pass)
      const current = await folder.currentHeader(this.saved.handle, base)
      if (!force && isForeign(current, device, this.saved.lastSeen)) {
        const file = conflictName(base, device, new Date().toISOString())
        await folder.writeConflict(this.saved.handle, file, bytes)
        return this.set({ state: 'conflict', name, file })
      }
      await folder.writeSnapshot(this.saved.handle, base, bytes, location.origin)
      this.saved.lastSeen = { device, generation: Number((await getMeta(this.db, 'generation')) ?? 0) }
      await folder.save(this.profile, this.saved)
      this.lastAt = new Date().toISOString()
      await this.refresh()
    } catch (e) {
      this.set({ state: 'error', name, message: e instanceof Error ? e.message : String(e) })
    } finally {
      this.busy = false
    }
  }

  /** Loads the folder's current snapshot into this browser (union by id, see restore.ts). */
  async loadFromFolder(onProgress: (m: string) => void): Promise<string> {
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
    const header = await folder.currentHeader(this.saved.handle, base)
    if (header) this.saved.lastSeen = { device: header.device, generation: header.generation }
    await folder.save(this.profile, this.saved)
    // The restore itself scheduled an autosave; that snapshot will carry the union.
    await this.refresh()
    return `Loaded ${r.people} new people and ${r.genomes} genomes from ${this.name} (${r.exportedAt}).`
  }
}

export const backups = new Backups()
