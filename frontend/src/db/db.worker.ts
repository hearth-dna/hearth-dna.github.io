/// <reference lib="webworker" />
import sqlite3InitModule, { type Database as Sqlite3Db, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * Dedicated SQLite worker. Owns the one connection to user.db (OPFS when available, memory
 * otherwise). Bulk inserts use a prepared statement inside a single transaction, which is what
 * makes a 700k-row genome import take seconds rather than minutes.
 */
type Req =
  | { id: number; op: 'open'; profile: string }
  | { id: number; op: 'exec'; sql: string; bind?: unknown[] }
  | { id: number; op: 'query'; sql: string; bind?: unknown[] }
  | {
      id: number
      op: 'bulk'
      sql: string
      rows: unknown[][]
      progressEvery?: number
      sortBy?: number[]
      before?: string
      after?: string
    }

type Res =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: number }

let sqlite3: Sqlite3Static
let db: Sqlite3Db
let persistent = false
let reason = ''

async function open(profile: string): Promise<{ persistent: boolean; reason: string }> {
  sqlite3 = await sqlite3InitModule()
  // The SAH-pool VFS needs no helper worker or cross-origin isolation, unlike the default "opfs"
  // VFS, and is the faster of the two. It allows one connection per VFS name — db.ts opens once.
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({
      name: `hearth-${profile}`,
      directory: `.hearth-${profile}`,
    })
    db = new pool.OpfsSAHPoolDb('/hearth.sqlite3')
    persistent = true
    db.exec('PRAGMA cache_size = -65536; PRAGMA temp_store = MEMORY; PRAGMA journal_mode = MEMORY')
  } catch (e) {
    reason = `OPFS unavailable: ${e instanceof Error ? e.message : String(e)}`
    db = new sqlite3.oo1.DB(':memory:', 'c')
  }
  return { persistent, reason }
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${String(v).replace(/'/g, "''")}'`
}

function handle(req: Req): unknown {
  switch (req.op) {
    case 'open':
      return open(req.profile)
    case 'exec':
      db.exec({ sql: req.sql, bind: req.bind as never })
      return undefined
    case 'query':
      return db.exec({ sql: req.sql, bind: req.bind as never, rowMode: 'object', returnValue: 'resultRows' })
    case 'bulk': {
      // Sorting by the primary-key columns turns random B-tree inserts into appends; with the
      // rsid index dropped for the duration (see repo.importCalls) a 700k-row genome lands in
      // seconds instead of minutes. synchronous=OFF is safe here: a crash mid-import loses only
      // the import, which is re-runnable, and the transaction is atomic either way.
      const rows = req.rows
      if (req.sortBy?.length) {
        const keys = req.sortBy
        rows.sort((a, b) => {
          for (const k of keys) {
            const x = a[k] as string | number
            const y = b[k] as string | number
            if (x < y) return -1
            if (x > y) return 1
          }
          return 0
        })
      }
      const every = req.progressEvery ?? 50000
      db.exec('PRAGMA synchronous = OFF')
      if (req.before) db.exec(req.before)
      // Literal-value SQL, not bound parameters: every sqlite-wasm bind() is a JS→WASM call with a
      // string copy (~18k rows/s measured, memory or OPFS alike), whereas SQLite's C parser eats
      // multi-row VALUES lists at ~90k rows/s. Values are escaped by doubling quotes.
      const BATCH = 2000
      const valuesIdx = req.sql.toUpperCase().lastIndexOf(' VALUES ')
      const head = req.sql.slice(0, valuesIdx + 8)
      db.exec('BEGIN')
      try {
        for (let i = 0; i < rows.length; i += BATCH) {
          const parts: string[] = []
          const end = Math.min(i + BATCH, rows.length)
          for (let r = i; r < end; r++) parts.push(`(${rows[r].map(literal).join(',')})`)
          db.exec(head + parts.join(','))
          if (end % every < BATCH || end === rows.length)
            postMessage({ id: req.id, progress: end } satisfies Res)
        }
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      if (req.after) db.exec(req.after)
      db.exec('PRAGMA synchronous = NORMAL')
      return rows.length
    }
  }
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data
  try {
    const result = await handle(req)
    postMessage({ id: req.id, ok: true, result } satisfies Res)
  } catch (e) {
    postMessage({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies Res)
  }
}
