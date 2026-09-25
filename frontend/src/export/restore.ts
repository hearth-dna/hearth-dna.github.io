import { gunzipSync, strFromU8 } from 'fflate'
import { decodePayload, extractPayload } from '../archive/payload'
import type { Database } from '../db/db'
import { genomeBlobName, importCalls, insertSourceFile, setParent, storeCalls } from '../db/repo'
import { parseRawText } from '../import/parseFile'
import { sha256Hex } from '../import/unpack'
import type { Person, SourceFile } from '../types'
import { type Container, openContainer, readHeader } from './container'
import { type DumpV1, deserialiseDump, expandDump } from './dump'

/**
 * Restores a dump into the database as a union by id: people, entries and consents that already
 * exist are left alone, everything else is added. Genotypes are only loaded for people who have
 * none yet. Accepts dump v2 (zip or envelope), dump v1 (gzip or envelope) and a portable
 * archive (.html with the v2 payload embedded).
 */
/** Progress callback: an i18n key (`src/i18n/en/restore.json`) plus its placeholders. */
export type Progress = (key: string, params?: Record<string, string | number>) => void

export interface RestoreResult {
  people: number
  genomes: number
  /** People whose genome file the dump listed but did not carry, and this browser does not have. */
  missing: { id: string; name: string }[]
  version: 1 | 2
  exportedAt: string
}

export async function restoreBytes(
  db: Database,
  bytes: Uint8Array,
  passphrase: string | undefined,
  onProgress: Progress = () => {},
): Promise<RestoreResult> {
  const b64 = looksLikeHtml(bytes) ? extractPayload(strFromU8(bytes)) : null
  if (b64) return restoreBytes(db, decodePayload(b64), passphrase, onProgress)
  if (readHeader(bytes)) {
    onProgress('restore.openingDump')
    return restoreContainer(db, await openContainer(bytes, passphrase), onProgress)
  }
  onProgress('restore.openingDump')
  return restoreV1(db, await deserialiseDump(bytes, passphrase), onProgress)
}

const looksLikeHtml = (b: Uint8Array) => strFromU8(b.subarray(0, 512)).trimStart().startsWith('<')

async function existingIds(db: Database, table: string): Promise<Set<string>> {
  return new Set((await db.query(`SELECT id FROM ${table}`)).map((r) => r.id as string))
}

async function personsWithGenotypes(db: Database): Promise<Set<string>> {
  return new Set(
    (await db.query('SELECT DISTINCT person_id FROM genotype')).map((r) => r.person_id as string),
  )
}

type Rows = Record<string, unknown>[]

/** INSERT OR IGNORE of raw rows, column names taken from the allowlist, never from the file. */
async function insertRows(db: Database, table: string, cols: string[], rows: Rows): Promise<void> {
  for (const r of rows) {
    await db.exec(
      `INSERT OR IGNORE INTO ${table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      cols.map((c) => r[c] ?? null),
    )
  }
}

async function insertConsents(db: Database, consents: Rows): Promise<void> {
  for (const c of consents) {
    if (c.revokedAt || c.revoked_at) continue // dumps from before revoke-is-delete
    await db.exec(
      `INSERT INTO consent(kind,version,subject,granted_at) SELECT ?,?,?,?
       WHERE NOT EXISTS (SELECT 1 FROM consent WHERE kind=? AND version=? AND subject=?)`,
      [c.kind, c.version, c.subject, c.grantedAt ?? c.granted_at, c.kind, c.version, c.subject],
    )
  }
}

const HEALTH_COLS = [
  'id',
  'person_id',
  'date',
  'time',
  'kind',
  'title',
  'body',
  'source',
  'body_part',
  'side',
  'severity',
  'tags',
  'value',
  'value2',
  'unit',
  'created_at',
]
const PERSON_COLS = ['id', 'label', 'display_name', 'sex', 'birth_year', 'notes', 'created_at']
const NOTE_COLS = ['id', 'person_id', 'topic', 'markdown', 'updated_at']
const CHAT_COLS = ['id', 'person_ids', 'question', 'context_pack', 'answer', 'tier', 'created_at']

function withDefaults(rows: Rows): Rows {
  return rows.map((h) => ({
    time: '',
    source: '',
    body_part: '',
    side: '',
    severity: null,
    tags: '',
    value: null,
    value2: null,
    unit: '',
    ...h,
  }))
}

export async function restoreContainer(
  db: Database,
  c: Container,
  onProgress: Progress = () => {},
): Promise<RestoreResult> {
  const j = c.journal
  const hadGenotypes = await personsWithGenotypes(db)
  const before = await existingIds(db, 'person')
  await insertRows(db, 'person', PERSON_COLS, j.persons as Rows)
  for (const r of j.relationships as { parentId: string; childId: string }[])
    await setParent(db, r.parentId, r.childId)
  for (const s of j.source_files as Rows)
    await insertSourceFile(db, {
      id: s.id as string,
      personId: s.person_id as string,
      provider: s.provider as SourceFile['provider'],
      build: s.build as string,
      sha256: s.sha256 as string,
      originalName: s.original_name as string,
      rowCount: s.row_count as number,
      importedAt: s.imported_at as string,
    })
  await insertRows(db, 'health_log', HEALTH_COLS, withDefaults(j.health_log as Rows))
  await insertRows(db, 'note', NOTE_COLS, j.notes as Rows)
  await insertRows(db, 'chat', CHAT_COLS, j.chats as Rows)
  await insertConsents(db, j.consents as Rows)
  for (const s of j.sharing_log as Rows) {
    await db.exec(
      `INSERT INTO sharing_log(kind,destination,payload,created_at) SELECT ?,?,?,?
       WHERE NOT EXISTS (SELECT 1 FROM sharing_log WHERE kind=? AND destination=? AND created_at=?)`,
      [s.kind, s.destination, s.payload, s.created_at, s.kind, s.destination, s.created_at],
    )
  }
  let genomes = 0
  const missing = new Set<string>()
  for (const g of c.manifest.genomes) {
    if (hadGenotypes.has(g.person_id)) continue
    if (!c.genomes[g.path]) {
      missing.add(g.person_id)
      continue
    }
    const text = strFromU8(gunzipSync(c.genomes[g.path]))
    onProgress('restore.parsingGenome', { n: genomes + 1, total: c.manifest.genomes.length })
    const r = await parseRawText(text, undefined, g.kind === 'original' ? g.provider : 'generic')
    onProgress('restore.storingCalls', { n: r.calls.length.toLocaleString() })
    await storeCalls(db, g.person_id, r.calls)
    // Keep the original so this browser's own backups ship it too.
    if (g.kind === 'original') await db.filePut(genomeBlobName(await sha256Hex(text)), c.genomes[g.path])
    genomes++
  }
  const after = await existingIds(db, 'person')
  return {
    people: after.size - before.size,
    genomes,
    missing: (j.persons as Rows)
      .filter((p) => missing.has(p.id as string))
      .map((p) => ({ id: p.id as string, name: (p.display_name as string) || (p.label as string) })),
    version: 2,
    exportedAt: c.header.exported_at,
  }
}

async function restoreV1(db: Database, dump: DumpV1, onProgress: Progress): Promise<RestoreResult> {
  const calls = expandDump(dump)
  const existing = await existingIds(db, 'person')
  const added = new Set<string>()
  for (const p of dump.persons as Person[]) {
    if (existing.has(p.id)) continue
    added.add(p.id)
    await db.exec(
      'INSERT INTO person(id,label,display_name,sex,birth_year,notes,created_at) VALUES (?,?,?,?,?,?,?)',
      [p.id, p.label, p.displayName, p.sex, p.birthYear, p.notes, p.createdAt],
    )
    const sf = dump.source_files.find((s) => s.personId === p.id)
    onProgress('restore.storingGenotypes', { name: p.displayName })
    await importCalls(
      db,
      p.id,
      {
        provider: sf?.provider ?? 'generic',
        build: sf?.build ?? '37',
        sha256: sf?.sha256 ?? '',
        originalName: sf?.originalName ?? 'dump-v1',
      },
      calls[p.id] ?? [],
    )
  }
  for (const r of dump.relationships) await setParent(db, r.parentId, r.childId)
  await insertRows(
    db,
    'health_log',
    HEALTH_COLS,
    withDefaults(((dump.health_log ?? []) as Rows).filter((h) => added.has(h.person_id as string))),
  )
  await insertConsents(db, dump.consents as Rows)
  return { people: added.size, genomes: added.size, missing: [], version: 1, exportedAt: dump.exported_at }
}
