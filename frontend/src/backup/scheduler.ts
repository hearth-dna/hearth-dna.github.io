import { mirrorAttachments, pullAttachments } from '../attachments/mirror'
import { missingLocally } from '../attachments/store'
import { Database } from '../db/db'
import { countAttachments, getMeta, setMeta } from '../db/repo'
import { readHeader } from '../export/container'
import {
  type Elsewhere,
  isDumpFile,
  type Progress,
  type RestoreResult,
  restoreBytes,
  restoreContainer,
  restoreGenome,
} from '../export/restore'
import { folderSnapshot, snapshotBytes } from '../export/snapshot'
import * as folder from './folder'
import { genomeLoader, mirrorGenomes, pickFor, readPickedGenomes } from './genomes'
import {
  attachmentsDirName,
  baseName,
  genomesDirName,
  hasNewer,
  type Seen,
  sharedName,
  spareNames,
} from './naming'
import { openRepaired } from './repair'
import { shareOrDownload } from './share'

/**
 * App-wide backup state: the remembered folder, the passphrase, a debounced autosave after every
 * write, and the one sync rule there is for now: **newer data in the folder is loaded first**, at
 * start, whenever the app comes back to the foreground, and before every backup. Loading is a union
 * by id (restore.ts), so nothing here is lost: a record both sides have keeps this device's
 * version, and a deletion does not travel. Real conflict resolution is future work. One instance
 * per page; the Settings card renders whatever `status` says and calls the actions.
 *
 * Browsers without a folder picker (phones, Safari, Firefox) get the `manual` state instead: a
 * snapshot is handed to the share sheet on request and a saved one is loaded from a file, and the
 * status only tracks whether anything changed since the last one.
 */
type Missing = { id: string; name: string }[]

/** What `loadFiles` brought in, for the card's message. */
export interface LoadResult {
  /** Backup files among the picked ones; 0 when only genome files were picked. */
  dumps: number
  name: string
  people: number
  genomes: number
  exportedAt: string
  /** Genome files taken, by file name, with whose DNA each was. */
  dna: { file: string; name: string }[]
  /** Picked files that were neither a backup nor a genome anything was waiting for. */
  unused: string[]
}

/** Genomes a loaded snapshot keeps in its folder's `genomes`; kept until their files are picked. */
const ELSEWHERE_KEY = 'genomes-elsewhere'

export type Status =
  | {
      state: 'manual'
      /** When this browser last shared or downloaded a snapshot (ISO). */
      lastAt: string | null
      /** This browser has changes no shared snapshot has. */
      dirty: boolean
      /** A snapshot that is built but still waits for a tap to open the share sheet. */
      file: string | null
      step: 'building' | 'loading' | null
      missing: Missing
    }
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
      /** Attached documents this browser has not copied to the folder yet. */
      attachmentsPending: number
      /** Attached documents this browser has a row for but not the bytes. */
      attachmentsMissing: number
      /** People whose genome file the last loaded snapshot and its spares all lacked. */
      missing: Missing
    }
  | { state: 'writing'; name: string; step: 'loading' | 'building' | 'writing' | 'attachments' }
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
  private busy = false
  private missing: Missing = []
  private elsewhere: Elsewhere[] = []
  /** Set when the browser has no folder picker; see the `manual` status. */
  private shared: folder.Shared | null = null
  private built: { name: string; bytes: Uint8Array; seen: Seen } | null = null
  private readonly listeners = new Set<() => void>()
  private readonly pulledListeners = new Set<() => void>()
  status: Status = { state: 'none' }

  async start(db: Database, appVersion: string): Promise<void> {
    this.db = db
    this.appVersion = appVersion
    this.profile = Database.profile()
    if (folder.supported()) this.saved = await folder.loadSaved(this.profile)
    else this.shared = (await folder.loadShared(this.profile)) ?? { lastSeen: null, plain: false }
    try {
      this.elsewhere = JSON.parse((await getMeta(db, ELSEWHERE_KEY)) ?? '[]')
    } catch {
      this.elsewhere = []
    }
    db.onChange(() => this.request())
    // Back in the foreground: another device may have written meanwhile.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refresh()
    })
    // Reading the folder can be slow (a cloud mount) or hang; startup must not wait for it.
    void this.refresh()
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  /** Called after data from the folder was loaded, so the pages show it without a reload. */
  onPulled(l: () => void): () => void {
    this.pulledListeners.add(l)
    return () => this.pulledListeners.delete(l)
  }

  private set(s: Status) {
    this.status = s
    for (const l of this.listeners) l()
  }

  get name(): string {
    return this.saved ? folder.placeName(this.saved.place) : ''
  }

  /** Where every read and write goes. */
  private get dir(): folder.Dir {
    if (!this.saved) throw new Error('no folder chosen')
    return folder.open(this.saved.place)
  }

  get plain(): boolean {
    return (this.shared ?? this.saved)?.plain ?? false
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

  /** Kept for the tab's session only. */
  setPassphrase(p: string): void {
    this.built = null
    try {
      if (p) sessionStorage.setItem(PASS_KEY(this.profile), p)
      else sessionStorage.removeItem(PASS_KEY(this.profile))
    } catch {}
    void this.refresh()
  }

  async setPlain(plain: boolean): Promise<void> {
    if (this.shared) {
      this.shared.plain = plain
      this.built = null
      await folder.saveShared(this.profile, this.shared)
      return this.refresh()
    }
    if (!this.saved) return
    this.saved.plain = plain
    await folder.save(this.profile, this.saved)
    await this.refresh()
  }

  /**
   * Re-derives the status from the folder, and loads a newer snapshot when there is one. Needs no
   * passphrase for that when the snapshot is not encrypted (a backup made without one); writing
   * back always does, unless the user chose plaintext for a folder they manage.
   */
  async refresh(): Promise<void> {
    if (this.shared) return this.refreshShared()
    if (!this.saved) return this.set({ state: 'none' })
    const name = this.name
    if ((await folder.permission(this.saved.place)) !== 'granted')
      return this.set({ state: 'reconnect', name })
    const device = (await getMeta(this.db, 'device')) ?? ''
    let current: Awaited<ReturnType<typeof folder.currentHeader>>
    try {
      current = await withTimeout(
        folder.currentHeader(this.dir, baseName(this.profile)),
        FOLDER_TIMEOUT_MS,
        name,
      )
    } catch (e) {
      return this.set({ state: 'error', name, message: e instanceof Error ? e.message : String(e) })
    }
    // Follow the folder: with no passphrase here and an unencrypted backup there (the other device
    // chose not to use one), keep writing it unencrypted rather than stop syncing. Unticking
    // "store unencrypted" and setting a passphrase encrypts from the next backup on.
    if (current && !current.encrypted && !this.passphrase() && !this.saved.plain) {
      this.saved.plain = true
      await folder.save(this.profile, this.saved)
    }
    const newer = hasNewer(current, device, this.saved.lastSeen)
    if (newer && current?.encrypted && !this.passphrase())
      return this.set({ state: 'needs-passphrase', name })
    if (newer) {
      // Newer data wins, without asking: pull it in, then write the union back when there is
      // anything of ours to add.
      if (!this.busy) void this.sync()
      return
    }
    if (!this.plain && !this.passphrase()) return this.set({ state: 'needs-passphrase', name })
    await this.pruneMissing()
    const dirty = await this.dirty(device, this.saved.lastSeen)
    // Counted from the database, never by listing the folder: refresh runs often and a cloud
    // mount is slow enough that a scan here would stall the whole card.
    const blobs = (await countAttachments(this.db)).blobs
    this.set({
      state: 'ready',
      name,
      pending: this.timer !== null,
      dirty,
      lastAt: this.saved.lastAt ?? null,
      attachmentsPending: Math.max(0, blobs - (this.saved.mirrored ?? 0)),
      attachmentsMissing: (await missingLocally(this.db)).length,
      missing: this.missing,
    })
    // Changes made while the folder was unreachable (or before a reload) go out without waiting
    // for the next edit.
    if (dirty && this.auto && !this.timer && !this.busy) this.request()
  }

  private async refreshShared(): Promise<void> {
    if (!this.shared) return
    await this.pruneMissing()
    const device = (await getMeta(this.db, 'device')) ?? ''
    this.set({
      state: 'manual',
      lastAt: this.shared.lastAt ?? null,
      dirty: await this.dirty(device, this.shared.lastSeen),
      file: this.built?.name ?? null,
      step: this.status.state === 'manual' ? this.status.step : null,
      missing: this.missing,
    })
  }

  private setStep(step: 'building' | 'loading' | null): void {
    if (this.status.state === 'manual') this.set({ ...this.status, step })
  }

  /** The missing-genomes notices go away once a genome is imported for that person by hand. */
  private async pruneMissing(): Promise<void> {
    const has = async (id: string) =>
      (await this.db.query('SELECT 1 FROM genotype WHERE person_id=? LIMIT 1', [id])).length > 0
    for (const m of [...this.missing]) if (await has(m.id)) this.missing = this.missing.filter((x) => x !== m)
    const left: Elsewhere[] = []
    for (const e of this.elsewhere) if (!(await has(e.entry.person_id))) left.push(e)
    if (left.length !== this.elsewhere.length) await this.setElsewhere(left)
  }

  /** People whose genome files a loaded snapshot keeps beside itself and nobody has picked yet. */
  get elsewhereNames(): Missing {
    return this.elsewhere.map((x) => ({ id: x.entry.person_id, name: x.name }))
  }

  private async setElsewhere(list: Elsewhere[]): Promise<void> {
    this.elsewhere = list
    await setMeta(this.db, ELSEWHERE_KEY, list.length ? JSON.stringify(list) : null)
  }

  /** Whether the database changed since this browser last wrote or loaded the snapshot `seen`. */
  private async dirty(device: string, seen: Seen | null | undefined): Promise<boolean> {
    const generation = Number((await getMeta(this.db, 'generation')) ?? 0)
    return !seen || seen.device !== device || generation > seen.generation
  }

  /** Choose (or replace) the folder. Must run from a click; backing out changes nothing. */
  async choose(): Promise<void> {
    const place = await folder.pick()
    if (!place) return
    this.saved = { place, lastSeen: null, plain: false, auto: true }
    await folder.save(this.profile, this.saved)
    await this.refresh()
  }

  async reconnect(): Promise<void> {
    if (!this.saved) return
    const place = await folder.reconnect(this.saved.place)
    if (!place) return
    this.saved.place = place
    await folder.save(this.profile, this.saved)
    await this.refresh()
  }

  /** Forgets the folder and, if asked, deletes the snapshots in it. */
  async forget(deleteFiles: boolean): Promise<{ snapshots: number; attachments: number }> {
    let n = 0
    let files = 0
    if (this.saved && deleteFiles) {
      n = await folder.deleteSnapshots(this.dir, baseName(this.profile))
      files = await folder.removeDir(this.dir, attachmentsDirName(this.profile))
      n += await folder.removeDir(this.dir, genomesDirName(this.profile))
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
    if (this.shared) {
      // A snapshot built before this change would be stale by the time it is shared.
      this.built = null
      if (!this.busy) void this.refresh()
      return
    }
    if (!this.saved || this.status.state === 'none') return
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
   * Brings in whatever the folder has that this device has not seen, then writes this device's
   * state back: the header's Sync button, and what `refresh` does when it finds newer data.
   */
  async sync(onProgress: Progress = () => {}): Promise<void> {
    if (this.busy) return
    this.cancelPending()
    const pulled = await this.pullIfNewer(onProgress)
    if (pulled === 'failed') return
    // After a pull the union is ahead of the folder only if this device had something of its own.
    await this.backupNow()
  }

  /**
   * Loads the folder's snapshot when it is newer than what this device last saw. 'failed' means the
   * status already says why (a wrong passphrase, an unreadable file).
   */
  private async pullIfNewer(onProgress: Progress): Promise<'pulled' | 'current' | 'failed'> {
    if (!this.saved) return 'current'
    const name = this.name
    this.busy = true
    try {
      const device = (await getMeta(this.db, 'device')) ?? ''
      const current = await folder.currentHeader(this.dir, baseName(this.profile))
      if (!hasNewer(current, device, this.saved.lastSeen)) return 'current'
      this.set({ state: 'writing', name, step: 'loading' })
      await this.pull(onProgress)
      return 'pulled'
    } catch (e) {
      this.set({ state: 'error', name, message: e instanceof Error ? e.message : String(e) })
      return 'failed'
    } finally {
      this.busy = false
    }
  }

  /** Writes a snapshot now, after loading anything newer the folder holds. */
  async backupNow(): Promise<void> {
    if (!this.saved || this.busy) return
    this.cancelPending()
    const name = this.name
    if ((await folder.permission(this.saved.place)) !== 'granted')
      return this.set({ state: 'reconnect', name })
    if ((await this.pullIfNewer(() => {})) === 'failed') return
    const pass = this.passphrase()
    if (!this.plain && !pass) return this.set({ state: 'needs-passphrase', name })
    const device = (await getMeta(this.db, 'device')) ?? ''
    // Nothing of ours the folder lacks (a pull just brought it level): no write, no new rotation.
    if (this.saved.lastSeen && !(await this.dirty(device, this.saved.lastSeen))) return this.refresh()
    this.busy = true
    this.set({ state: 'writing', name, step: 'building' })
    try {
      const base = baseName(this.profile)
      const dir = this.dir
      const key = this.plain ? undefined : pass
      // Genomes beside the snapshot, written once; after an edit this writes the journal alone.
      const snap = await folderSnapshot(this.db, this.appVersion, key)
      this.set({ state: 'writing', name, step: 'writing' })
      await mirrorGenomes(dir, this.db, this.profile, snap.files, key ?? null)
      await folder.writeSnapshot(dir, base, snap.bytes, location.origin)
      this.saved.lastSeen = { device, generation: Number((await getMeta(this.db, 'generation')) ?? 0) }
      this.saved.lastAt = new Date().toISOString()
      await folder.save(this.profile, this.saved)
      this.set({ state: 'writing', name, step: 'attachments' })
      await this.mirror()
    } catch (e) {
      this.set({ state: 'error', name, message: e instanceof Error ? e.message : String(e) })
      return
    } finally {
      this.busy = false
    }
    await this.refresh()
  }

  /**
   * Copies documents the folder does not have yet. Deliberately not fatal: the journal is already
   * written by this point, and a folder that refuses a file must not cost the user the snapshot.
   */
  private async mirror(): Promise<void> {
    if (!this.saved) return
    try {
      const dir = this.dir
      const r = await withTimeout(
        mirrorAttachments(dir, this.db, this.profile, this.plain ? null : this.passphrase()),
        FOLDER_TIMEOUT_MS,
        this.name,
      )
      const sub = await dir.subdir(attachmentsDirName(this.profile))
      this.saved.mirrored = sub ? (await sub.names()).length : r.written
      await folder.save(this.profile, this.saved)
    } catch {
      // Left for the next backup; `attachmentsPending` keeps saying there is work to do.
    }
  }

  /** Fetches documents this browser has rows for but not bytes (after restoring on a new PC). */
  async pullNow(): Promise<{ pulled: number; missing: number }> {
    if (!this.saved) return { pulled: 0, missing: 0 }
    const r = await pullAttachments(this.dir, this.db, this.profile, this.plain ? null : this.passphrase())
    await this.refresh()
    return r
  }

  /** Loads the folder's current snapshot into this browser (union by id, see restore.ts). */
  async loadFromFolder(onProgress: Progress): Promise<RestoreResult> {
    this.busy = true
    let r: RestoreResult
    try {
      r = await this.pull(onProgress)
    } finally {
      this.busy = false
    }
    await this.refresh()
    return r
  }

  /** The load itself: the snapshot, then its documents; remembers what was seen. */
  private async pull(onProgress: Progress): Promise<RestoreResult> {
    if (!this.saved) throw new Error('no folder chosen')
    const base = baseName(this.profile)
    const dir = this.dir
    const bytes = await dir.read(base)
    if (!bytes) throw new Error(`no ${base} in ${this.name}`)
    // A plaintext snapshot needs no passphrase; an encrypted one says so if it is missing.
    const pass = this.passphrase() || undefined
    const loadGenome = await genomeLoader(dir, this.profile, pass ?? null)
    // An older snapshot that lost genome files is filled from the copies beside it.
    const c = await openRepaired(
      bytes,
      pass,
      spareNames(await dir.names(), base),
      (n) => dir.read(n),
      onProgress,
    )
    const r = await restoreContainer(this.db, c, onProgress, loadGenome)
    this.missing = r.missing
    onProgress('restore.pullingAttachments')
    await pullAttachments(dir, this.db, this.profile, this.passphrase() || null)
    const header = readHeader(bytes)
    if (header) this.saved.lastSeen = { device: header.device, generation: header.generation }
    await folder.save(this.profile, this.saved)
    for (const l of this.pulledListeners) l()
    return r
  }

  /**
   * Builds a snapshot (unless one is already waiting) and hands it to the share sheet, or
   * downloads it where files cannot be shared. Must run from a click. When building took so long
   * that the browser no longer counts the click, the snapshot waits in `status.file` for another.
   */
  async shareNow(): Promise<'shared' | 'downloaded' | 'waiting' | 'cancelled' | undefined> {
    if (!this.shared || this.busy) return
    const pass = this.passphrase()
    if (!this.plain && !pass) return
    if (!this.built) {
      this.busy = true
      this.setStep('building')
      try {
        const bytes = await snapshotBytes(this.db, this.appVersion, this.plain ? undefined : pass)
        const device = (await getMeta(this.db, 'device')) ?? ''
        const generation = Number((await getMeta(this.db, 'generation')) ?? 0)
        this.built = { name: sharedName(this.profile, new Date()), bytes, seen: { device, generation } }
      } finally {
        this.busy = false
        this.setStep(null)
      }
    }
    const built = this.built
    try {
      const how = await shareOrDownload(built.bytes, built.name)
      this.built = null
      this.shared.lastSeen = built.seen
      this.shared.lastAt = new Date().toISOString()
      await folder.saveShared(this.profile, this.shared)
      return how
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') return 'waiting'
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      throw e
    } finally {
      await this.refresh()
    }
  }

  /**
   * Loads what the user picked, in one go: backup files (union by id, see restore.ts) and the
   * genome files a folder snapshot keeps in its `genomes` folder, recognised by content. Genomes
   * not among them are remembered (in `meta`, so a reload keeps them) until their files are picked.
   */
  async loadFiles(
    files: File[],
    onProgress: Progress = () => {},
    passphrase = this.passphrase(),
  ): Promise<LoadResult> {
    if (this.busy) throw new Error('a backup is in progress')
    this.busy = true
    this.setStep('loading')
    try {
      const picked = await Promise.all(
        files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
      )
      let dumps = picked.filter((f) => isDumpFile(f.bytes))
      let rest = picked.filter((f) => !dumps.includes(f))
      // One file that is neither (an older dump v1, or something else): the restore says which.
      if (!dumps.length && rest.length === 1 && !this.elsewhere.length) [dumps, rest] = [rest, []]
      const out: LoadResult = {
        dumps: dumps.length,
        name: '',
        people: 0,
        genomes: 0,
        exportedAt: '',
        dna: [],
        unused: [],
      }
      const same = (a: Elsewhere, b: Elsewhere) =>
        a.entry.person_id === b.entry.person_id && a.entry.sha256 === b.entry.sha256
      let elsewhere = this.elsewhere
      const missing: Missing = []
      for (const d of dumps) {
        // Genomes beside a folder snapshot come back as `elsewhere`, matched below like any other.
        const r = await restoreBytes(this.db, d.bytes, passphrase || undefined, onProgress)
        out.name = d.name
        out.people += r.people
        out.genomes += r.genomes
        out.exportedAt = r.exportedAt
        missing.push(...r.missing)
        elsewhere = [...elsewhere.filter((x) => !r.elsewhere.some((y) => same(x, y))), ...r.elsewhere]
      }
      const genomes = await readPickedGenomes(
        rest.map((f) => f.bytes),
        passphrase || null,
      )
      const used = new Set<number>()
      const left: Elsewhere[] = []
      for (const x of elsewhere) {
        const at = pickFor(x, genomes)
        if (at < 0) {
          left.push(x)
          continue
        }
        used.add(at)
        const has = await this.db.query('SELECT 1 FROM genotype WHERE person_id=? LIMIT 1', [
          x.entry.person_id,
        ])
        if (!has.length) {
          await restoreGenome(this.db, x.entry, (genomes[at] as { gz: Uint8Array }).gz, onProgress, {
            n: out.dna.length + 1,
            total: elsewhere.length,
          })
          out.genomes++
        }
        out.dna.push({ file: rest[at].name, name: x.name })
      }
      await this.setElsewhere(left)
      if (dumps.length) this.missing = missing
      out.unused = rest.filter((_, i) => !used.has(i)).map((f) => f.name)
      for (const l of this.pulledListeners) l()
      return out
    } finally {
      this.busy = false
      this.setStep(null)
      await this.refresh()
    }
  }
}

export const backups = new Backups()
