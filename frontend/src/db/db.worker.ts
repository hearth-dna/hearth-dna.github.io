/// <reference lib="webworker" />
import sqlite3InitModule, { type Database as Sqlite3Db, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/**
 * Dedicated SQLite worker. Owns the one connection to user.db (OPFS when available, memory
 * otherwise). Bulk inserts use a prepared statement inside a single transaction, which is what
 * makes a 700k-row genome import take seconds rather than minutes.
 *
 * It also owns a small file cache next to the database (OPFS directory, or a Map in memory) that
 * holds the original genome files so a backup does not have to re-serialise millions of rows
 * (docs/architecture/storage/dump-v2.md).
 */
type Req =
  | { id: number; op: 'open'; profile: string; memory?: boolean; wasmUrl?: string }
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
  | { id: number; op: 'file-put'; name: string; bytes: Uint8Array }
  | { id: number; op: 'file-get'; name: string }
  | { id: number; op: 'file-delete'; name: string }
  | { id: number; op: 'file-list' }
  | { id: number; op: 'genome-gz'; personId: string }
  | {
      id: number
      op: 'genotype-table'
      columns: { id: string; name: string }[]
      format: 'csv' | 'jsonl'
      /** Only SNPs every listed person has a call for. */
      shared: boolean
    }

type Res =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: number }

const OPFS_ATTEMPTS = 10
const OPFS_RETRY_MS = 300

let sqlite3: Sqlite3Static
let db: Sqlite3Db
let persistent = false
let reason = ''
let filesDir: FileSystemDirectoryHandle | null = null
const memoryFiles = new Map<string, Uint8Array>()

async function open(req: { profile: string; memory?: boolean; wasmUrl?: string }) {
  const { profile, memory, wasmUrl } = req
  // The portable archive inlines sqlite3.wasm as a data: URL and hands the bytes straight to the
  // Emscripten loader (fetching from inside a blob worker on a file:// page never resolves); the
  // hosted build lets sqlite-wasm find the file next to its own module.
  const init = sqlite3InitModule as unknown as (o?: object) => Promise<Sqlite3Static>
  sqlite3 = await init(
    wasmUrl
      ? {
          locateFile: () => wasmUrl,
          wasmBinary: wasmUrl.startsWith('data:') ? dataUrlBytes(wasmUrl) : undefined,
        }
      : undefined,
  )
  if (memory) {
    db = new sqlite3.oo1.DB(':memory:', 'c')
    return { persistent: false, reason: 'memory requested' }
  }
  // The SAH-pool VFS needs no helper worker or cross-origin isolation, unlike the default "opfs"
  // VFS, and is the faster of the two. It allows one connection per VFS name — db.ts opens once.
  // The access handles are exclusive; a tab that just handed over releases them asynchronously,
  // so retry for a few seconds before concluding OPFS is really unavailable.
  for (let attempt = 0; attempt < OPFS_ATTEMPTS; attempt++) {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs({
        name: `hearth-${profile}`,
        directory: `.hearth-${profile}`,
      })
      db = new pool.OpfsSAHPoolDb('/hearth.sqlite3')
      persistent = true
      db.exec('PRAGMA cache_size = -65536; PRAGMA temp_store = MEMORY; PRAGMA journal_mode = MEMORY')
      const root = await navigator.storage.getDirectory()
      filesDir = await root.getDirectoryHandle(`hearth-${profile}-files`, { create: true })
      return { persistent, reason: '' }
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e)
      await new Promise((r) => setTimeout(r, OPFS_RETRY_MS))
    }
  }
  // Memory is a last resort the UI must surface: nothing survives a reload. db.ts reports it.
  db = new sqlite3.oo1.DB(':memory:', 'c')
  return { persistent, reason }
}

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ---- file cache -----------------------------------------------------------------------------

const safeName = (name: string) => {
  if (!/^[a-z0-9._-]{1,120}$/i.test(name)) throw new Error(`bad file name ${name}`)
  return name
}

async function filePut(name: string, bytes: Uint8Array): Promise<void> {
  safeName(name)
  if (!filesDir) {
    memoryFiles.set(name, bytes)
    return
  }
  const handle = await filesDir.getFileHandle(name, { create: true })
  const access = await handle.createSyncAccessHandle()
  try {
    access.truncate(0)
    access.write(bytes, { at: 0 })
    access.flush()
  } finally {
    access.close()
  }
}

async function fileGet(name: string): Promise<Uint8Array | null> {
  safeName(name)
  if (!filesDir) return memoryFiles.get(name) ?? null
  try {
    const handle = await filesDir.getFileHandle(name)
    return new Uint8Array(await (await handle.getFile()).arrayBuffer())
  } catch {
    return null
  }
}

async function fileDelete(name: string): Promise<void> {
  safeName(name)
  if (!filesDir) {
    memoryFiles.delete(name)
    return
  }
  await filesDir.removeEntry(name).catch(() => {})
}

async function fileList(): Promise<string[]> {
  if (!filesDir) return [...memoryFiles.keys()]
  const names: string[] = []
  for await (const name of filesDir.keys()) names.push(name)
  return names
}

/**
 * A person's genotypes as gzipped generic provider text, built and compressed here so millions
 * of rows never cross to the main thread. Used when the original file was not cached (data
 * imported before dump v2).
 */
async function genomeGz(personId: string): Promise<Uint8Array> {
  const stream = new Blob([genomeText(personId)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * One row per SNP with a genotype column per person, as CSV or JSON Lines bytes
 * (docs/architecture/storage/open-formats.md). Built here so millions of rows never leave the
 * worker: one MAX(CASE …) column per person, ordered numerically by chromosome.
 */
function genotypeTable(columns: { id: string; name: string }[], format: 'csv' | 'jsonl', shared: boolean) {
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`
  const cols = columns.map((c, i) => `MAX(CASE WHEN person_id = ${q(c.id)} THEN a1 || a2 END) AS g${i}`)
  const sql = `SELECT rsid, chromosome, position${cols.length ? `, ${cols.join(', ')}` : ''} FROM genotype
    WHERE person_id IN (${columns.map((c) => q(c.id)).join(',') || "''"}) GROUP BY rsid
    ${shared ? `HAVING COUNT(*) = ${columns.length}` : ''}
    ORDER BY CASE WHEN chromosome GLOB '[0-9]*' THEN CAST(chromosome AS INTEGER) ELSE 100 END, chromosome, position`
  const names = ['rsid', 'chromosome', 'position', ...columns.map((c) => c.name)]
  const csvCell = (v: string) => (/[",\r\n]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  let lines: string[] = format === 'csv' ? [`\uFEFF${names.map(csvCell).join(',')}`] : []
  let rows = 0
  const flush = () => {
    chunks.push(enc.encode(`${lines.join('\n')}\n`))
    lines = []
  }
  const stmt = db.prepare(sql)
  try {
    while (stmt.step()) {
      const r = stmt.get([]) as (string | number | null)[]
      if (format === 'csv') lines.push(r.map((v) => (v === null ? '' : csvCell(String(v)))).join(','))
      else {
        const o: Record<string, unknown> = {}
        names.forEach((n, i) => {
          o[n] = r[i]
        })
        lines.push(JSON.stringify(o))
      }
      if (++rows % 50000 === 0) flush()
    }
  } finally {
    stmt.finalize()
  }
  if (lines.length) flush()
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const bytes = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    bytes.set(c, o)
    o += c.length
  }
  return { bytes, rows }
}

function genomeText(personId: string): string {
  const lines = ['# Hearth export: rsid chromosome position genotype (forward strand)']
  const stmt = db.prepare(
    'SELECT rsid, chromosome, position, a1 || a2 FROM genotype WHERE person_id = ? ORDER BY chromosome, position',
  )
  try {
    stmt.bind([personId])
    while (stmt.step()) {
      const r = stmt.get([]) as [string, string, number, string]
      lines.push(`${r[0]}\t${r[1]}\t${r[2]}\t${r[3]}`)
    }
  } finally {
    stmt.finalize()
  }
  return `${lines.join('\n')}\n`
}

// ---- SQL ------------------------------------------------------------------------------------

/** Every user-data write bumps meta.generation, which backups use to tell snapshots apart. */
const isWrite = (sql: string) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql) && !/\bmeta\b/i.test(sql)
const BUMP =
  "INSERT INTO meta(key, value) VALUES ('generation', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${String(v).replace(/'/g, "''")}'`
}

function handle(req: Req): unknown {
  switch (req.op) {
    case 'open':
      return open(req)
    case 'exec':
      db.exec({ sql: req.sql, bind: req.bind as never })
      if (isWrite(req.sql)) db.exec(BUMP)
      return undefined
    case 'query':
      return db.exec({ sql: req.sql, bind: req.bind as never, rowMode: 'object', returnValue: 'resultRows' })
    case 'file-put':
      return filePut(req.name, req.bytes)
    case 'file-get':
      return fileGet(req.name)
    case 'file-delete':
      return fileDelete(req.name)
    case 'file-list':
      return fileList()
    case 'genome-gz':
      return genomeGz(req.personId)
    case 'genotype-table':
      return genotypeTable(req.columns, req.format, req.shared)
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
        db.exec(BUMP)
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
