import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'

/**
 * Main-thread handle to the SQLite worker (db.worker.ts). One request in flight at a time is not
 * required — requests are matched by id — but the worker executes them sequentially.
 */
export type Row = Record<string, unknown>

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (n: number) => void }

export interface OpenOptions {
  /** Fires if a newer tab claims the database; this instance is dead from then on. */
  onTakenOver?: () => void
  /** Memory only, no lock, no OPFS: the portable archive. */
  memory?: boolean
  /** Where sqlite3.wasm lives when the worker cannot find it next to itself (inline worker). */
  wasmUrl?: string
  /** A worker constructor other than the bundled module worker (the archive inlines it). */
  worker?: () => Worker
}

export class Database {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Set<() => void>()

  private constructor(
    private readonly worker: Worker,
    readonly persistent: boolean,
    /** Why the database is not persistent ('' when it is). */
    readonly reason = '',
  ) {}

  private static instance: Promise<Database> | null = null

  /** How long a new tab waits for the owner to hand over before stealing the lock. */
  static readonly TAKEOVER_GRACE_MS = 1500

  /** Singleton: React StrictMode runs effects twice in dev, and the OPFS VFS allows one connection. */
  static open(opts: OpenOptions = {}): Promise<Database> {
    Database.instance ??= Database.openOnce(opts)
    return Database.instance
  }

  /** `?profile=name` selects a separate local database (a second family, or a dev sandbox). */
  static profile(): string {
    const p = new URLSearchParams(location.search).get('profile') ?? 'default'
    return /^[a-z0-9_-]{1,32}$/i.test(p) ? p : 'default'
  }

  private static async openOnce(opts: OpenOptions): Promise<Database> {
    const profile = Database.profile()
    const name = `hearth-db-${profile}`
    let release = () => {}
    let channel: BroadcastChannel | null = null
    let lost = () => {} // called when a newer tab steals our lock
    if (!opts.memory) {
      // One tab owns the database at a time: the OPFS SAH pool needs exclusive handles. The newest
      // tab always wins (WhatsApp Web style): it asks the current owner to let go over a
      // BroadcastChannel and waits briefly for the Web Lock; if the owner does not answer — a tab
      // running older code, or a parked page — it steals the lock. The browser also releases the
      // lock when the owning tab closes.
      channel = new BroadcastChannel(name)
      channel.postMessage('takeover')
      const hold = (lock: Lock | null) => {
        if (!lock) return
        return new Promise<void>((r) => {
          release = r
        })
      }
      let stealing = false
      const acquired = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), Database.TAKEOVER_GRACE_MS)
        navigator.locks
          .request(name, (lock) => {
            clearTimeout(timer)
            resolve(true)
            return hold(lock)
          })
          // Rejects when a newer tab steals from us — or when we steal ourselves (then ignore).
          .catch(() => !stealing && lost())
      })
      if (!acquired) {
        stealing = true
        await new Promise<void>((resolve) => {
          navigator.locks
            .request(name, { steal: true }, (lock) => {
              resolve()
              return hold(lock)
            })
            .catch(() => lost())
        })
        // The previous owner learns of the steal asynchronously; let it terminate its worker
        // before we ask OPFS for the same access handles.
        await new Promise((r) => setTimeout(r, 300))
      }
    }
    const worker = opts.worker
      ? opts.worker()
      : new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' })
    const db = new Database(worker, false)
    let ready: Database | undefined // assigned after the open handshake; shutdown may run before
    const shutdown = () => {
      worker.terminate()
      db.failPending('database closed')
      ready?.failPending('database closed')
      release()
    }
    // The OPFS SAH pool holds exclusive sync access handles; a page parked in the back-forward
    // cache would otherwise keep them and block the next load from opening the database.
    window.addEventListener('pagehide', shutdown)
    const takenOver = () => {
      shutdown()
      opts.onTakenOver?.()
    }
    if (channel) channel.onmessage = (ev) => ev.data === 'takeover' && takenOver()
    lost = takenOver
    worker.onmessage = (ev) => db.onMessage(ev.data)
    const { persistent, reason } = (await db.send({
      op: 'open',
      profile,
      memory: opts.memory,
      wasmUrl: opts.wasmUrl,
    })) as { persistent: boolean; reason: string }
    if (!persistent && !opts.memory) console.warn('[hearth db] not persistent —', reason)
    ready = new Database(worker, persistent, reason)
    // Re-point the worker at the final instance's pending map.
    worker.onmessage = (ev) => ready.onMessage(ev.data)
    await ready.exec('PRAGMA foreign_keys = ON')
    await ready.exec(SCHEMA_SQL)
    // Revoking a consent deletes it; rows stamped by the old flag-only revoke are dead weight.
    await ready.exec('DELETE FROM consent WHERE revoked_at IS NOT NULL')
    // Duplicates from before grantConsent was idempotent: keep the earliest record of each.
    await ready.exec(
      'DELETE FROM consent WHERE id NOT IN (SELECT MIN(id) FROM consent GROUP BY kind, version, subject)',
    )
    // Additive column migrations: CREATE TABLE IF NOT EXISTS leaves existing tables untouched.
    for (const col of [
      "source TEXT NOT NULL DEFAULT ''",
      "body_part TEXT NOT NULL DEFAULT ''",
      'severity INTEGER',
      "tags TEXT NOT NULL DEFAULT ''",
    ]) {
      await ready.exec(`ALTER TABLE health_log ADD COLUMN ${col}`).catch(() => {})
    }
    await ready.exec('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)', [
      'schema_version',
      String(SCHEMA_VERSION),
    ])
    // Identifies this browser profile in backup headers (random, not derived from hardware).
    await ready.exec('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)', ['device', crypto.randomUUID()])
    await ready.exec('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)', ['generation', '0'])
    return ready
  }

  private failPending(why: string) {
    for (const p of this.pending.values()) p.reject(new Error(why))
    this.pending.clear()
  }

  private onMessage(msg: { id: number; ok?: boolean; result?: unknown; error?: string; progress?: number }) {
    const p = this.pending.get(msg.id)
    if (!p) return
    if (typeof msg.progress === 'number') {
      p.onProgress?.(msg.progress)
      return
    }
    this.pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new Error(msg.error ?? 'db error'))
  }

  private send(req: Record<string, unknown>, onProgress?: (n: number) => void): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress })
      this.worker.postMessage({ id, ...req })
    })
  }

  /** Called after every write to user data (the worker bumps meta.generation at the same time). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed() {
    for (const l of this.listeners) l()
  }

  async exec(sql: string, bind?: unknown[]): Promise<void> {
    await this.send({ op: 'exec', sql, bind })
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql) && !/\bmeta\b/i.test(sql)) this.changed()
  }

  async query<T extends Row = Row>(sql: string, bind?: unknown[]): Promise<T[]> {
    return ((await this.send({ op: 'query', sql, bind })) as T[]) ?? []
  }

  async one<T extends Row = Row>(sql: string, bind?: unknown[]): Promise<T | undefined> {
    return (await this.query<T>(sql, bind))[0]
  }

  /** Prepared-statement insert of every row inside one transaction, in the worker. */
  async bulkInsert(
    table: string,
    cols: string[],
    rows: unknown[][],
    opts: { onProgress?: (n: number) => void; sortBy?: string[]; before?: string; after?: string } = {},
  ): Promise<void> {
    const sql = `INSERT OR REPLACE INTO ${table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
    const sortBy = opts.sortBy?.map((c) => cols.indexOf(c)).filter((i) => i >= 0)
    await this.send(
      { op: 'bulk', sql, rows, sortBy, before: opts.before, after: opts.after },
      opts.onProgress,
    )
    opts.onProgress?.(rows.length)
    this.changed()
  }

  // ---- file cache next to the database (original genome files, see dump-v2.md) ---------------

  async filePut(name: string, bytes: Uint8Array): Promise<void> {
    await this.send({ op: 'file-put', name, bytes })
  }

  async fileGet(name: string): Promise<Uint8Array | null> {
    return (await this.send({ op: 'file-get', name })) as Uint8Array | null
  }

  async fileDelete(name: string): Promise<void> {
    await this.send({ op: 'file-delete', name })
  }

  async fileList(): Promise<string[]> {
    return (await this.send({ op: 'file-list' })) as string[]
  }

  /** A person's genotypes as generic provider text, built inside the worker. */
  async genomeText(personId: string): Promise<string> {
    return (await this.send({ op: 'genome-text', personId })) as string
  }
}
