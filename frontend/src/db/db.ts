import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'

/**
 * Main-thread handle to the SQLite worker (db.worker.ts). One request in flight at a time is not
 * required — requests are matched by id — but the worker executes them sequentially.
 */
export type Row = Record<string, unknown>

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (n: number) => void }

export class Database {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  private constructor(
    private readonly worker: Worker,
    readonly persistent: boolean,
  ) {}

  private static instance: Promise<Database> | null = null

  /** Singleton: React StrictMode runs effects twice in dev, and the OPFS VFS allows one connection. */
  static open(): Promise<Database> {
    Database.instance ??= Database.openOnce()
    return Database.instance
  }

  /** `?profile=name` selects a separate local database (a second family, or a dev sandbox). */
  static profile(): string {
    const p = new URLSearchParams(location.search).get('profile') ?? 'default'
    return /^[a-z0-9_-]{1,32}$/i.test(p) ? p : 'default'
  }

  private static async openOnce(): Promise<Database> {
    const profile = Database.profile()
    // One tab owns the database at a time: the OPFS SAH pool needs exclusive handles. Fail fast
    // with a clear message rather than silently running in memory.
    const held = await new Promise<boolean>((resolve) => {
      navigator.locks.request(`hearth-db-${profile}`, { ifAvailable: true }, (lock) => {
        resolve(lock !== null)
        // Hold the lock for the lifetime of this page; the browser releases it on unload.
        return lock ? new Promise<never>(() => {}) : undefined
      })
    })
    if (!held)
      throw new Error(
        'Hearth is already open in another tab of this browser. Close it (or use ?profile=<name>) and reload.',
      )
    const worker = new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' })
    // The OPFS SAH pool holds exclusive sync access handles; a page parked in the back-forward
    // cache would otherwise keep them and block the next load from opening the database.
    window.addEventListener('pagehide', () => worker.terminate())
    const db = new Database(worker, false)
    worker.onmessage = (ev) => db.onMessage(ev.data)
    const { persistent, reason } = (await db.send({ op: 'open', profile })) as {
      persistent: boolean
      reason: string
    }
    if (!persistent) console.warn('[hearth db] not persistent —', reason)
    const ready = new Database(worker, persistent)
    // Re-point the worker at the final instance's pending map.
    worker.onmessage = (ev) => ready.onMessage(ev.data)
    await ready.exec('PRAGMA foreign_keys = ON')
    await ready.exec(SCHEMA_SQL)
    // Revoking a consent deletes it; rows stamped by the old flag-only revoke are dead weight.
    await ready.exec('DELETE FROM consent WHERE revoked_at IS NOT NULL')
    // Additive column migrations: CREATE TABLE IF NOT EXISTS leaves existing tables untouched.
    await ready.exec("ALTER TABLE health_log ADD COLUMN source TEXT NOT NULL DEFAULT ''").catch(() => {})
    await ready.exec('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)', [
      'schema_version',
      String(SCHEMA_VERSION),
    ])
    return ready
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

  async exec(sql: string, bind?: unknown[]): Promise<void> {
    await this.send({ op: 'exec', sql, bind })
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
  }
}
