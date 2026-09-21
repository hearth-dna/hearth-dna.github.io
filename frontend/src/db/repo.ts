import { attachmentBlobName } from '../attachments/file'
import { formatTags, normTime, parseTags } from '../health/log'
import type { Attachment, Call, HealthEntry, HealthKind, Person, Provider, Sex, SourceFile } from '../types'
import type { Database, Row } from './db'

export function newId(): string {
  return crypto.randomUUID()
}

export const now = () => new Date().toISOString()

// ---- persons -------------------------------------------------------------------------------

export async function listPersons(db: Database): Promise<Person[]> {
  const rows = await db.query('SELECT * FROM person ORDER BY created_at')
  return rows.map(rowToPerson)
}

export async function addPerson(
  db: Database,
  p: { label: string; displayName: string; sex: Sex; birthYear: number | null },
): Promise<Person> {
  const person: Person = { id: newId(), notes: '', createdAt: now(), ...p }
  await db.exec(
    'INSERT INTO person(id,label,display_name,sex,birth_year,notes,created_at) VALUES (?,?,?,?,?,?,?)',
    [
      person.id,
      person.label,
      person.displayName,
      person.sex,
      person.birthYear,
      person.notes,
      person.createdAt,
    ],
  )
  return person
}

export async function updatePerson(
  db: Database,
  id: string,
  p: { displayName: string; sex: Sex; birthYear: number | null },
): Promise<void> {
  await db.exec('UPDATE person SET display_name=?, sex=?, birth_year=? WHERE id=?', [
    p.displayName,
    p.sex,
    p.birthYear,
    id,
  ])
}

export async function deletePerson(db: Database, id: string): Promise<void> {
  await db.exec('DELETE FROM person WHERE id = ?', [id])
  await pruneBlobs(db)
}

function rowToPerson(r: Row): Person {
  return {
    id: r.id as string,
    label: r.label as string,
    displayName: r.display_name as string,
    sex: r.sex as Sex,
    birthYear: (r.birth_year as number | null) ?? null,
    notes: r.notes as string,
    createdAt: r.created_at as string,
  }
}

// ---- pedigree -------------------------------------------------------------------------------

export async function setParent(db: Database, parentId: string, childId: string): Promise<void> {
  await db.exec('INSERT OR IGNORE INTO relationship(parent_id, child_id) VALUES (?,?)', [parentId, childId])
}
export async function unsetParent(db: Database, parentId: string, childId: string): Promise<void> {
  await db.exec('DELETE FROM relationship WHERE parent_id=? AND child_id=?', [parentId, childId])
}
export async function listRelationships(db: Database): Promise<{ parentId: string; childId: string }[]> {
  const rows = await db.query('SELECT parent_id, child_id FROM relationship')
  return rows.map((r) => ({ parentId: r.parent_id as string, childId: r.child_id as string }))
}

// ---- genotypes ------------------------------------------------------------------------------

export async function importCalls(
  db: Database,
  personId: string,
  meta: { provider: Provider; build: string; sha256: string; originalName: string },
  calls: Call[],
  onProgress?: (n: number) => void,
): Promise<SourceFile> {
  const sf: SourceFile = { id: newId(), personId, rowCount: calls.length, importedAt: now(), ...meta }
  await storeCalls(db, personId, calls, onProgress)
  await insertSourceFile(db, sf)
  return sf
}

/** Genotype rows only; the source_file row is the caller's business (restores keep the original). */
export async function storeCalls(
  db: Database,
  personId: string,
  calls: Call[],
  onProgress?: (n: number) => void,
): Promise<void> {
  await db.bulkInsert(
    'genotype',
    ['person_id', 'rsid', 'chromosome', 'position', 'a1', 'a2'],
    calls.map((c) => [personId, c.rsid, c.chromosome, c.position, c.a1, c.a2]),
    {
      onProgress,
      sortBy: ['person_id', 'rsid'],
      before: 'DROP INDEX IF EXISTS genotype_rsid',
      after: 'CREATE INDEX IF NOT EXISTS genotype_rsid ON genotype(rsid)',
    },
  )
}

export async function insertSourceFile(db: Database, sf: SourceFile): Promise<void> {
  await db.exec(
    'INSERT OR IGNORE INTO source_file(id,person_id,provider,build,sha256,original_name,row_count,imported_at) VALUES (?,?,?,?,?,?,?,?)',
    [sf.id, sf.personId, sf.provider, sf.build, sf.sha256, sf.originalName, sf.rowCount, sf.importedAt],
  )
}

/** Where the gzipped original of a source file is cached next to the database (dump v2). */
export const genomeBlobName = (sha256OfText: string) => `genome-${sha256OfText}.gz`

/**
 * Where a rebuilt generic-format genome is cached for a person imported before the originals
 * were kept. The row count is part of the name so a later import invalidates it.
 */
export const rebuiltBlobName = (personId: string, rows: number) => `generic-${personId}-${rows}.gz`

/**
 * Drops cached files nothing refers to any more (after delete, revoke, erase, re-import): genome
 * originals, rebuilt genomes and attached documents.
 *
 * The whole keep-set is built before the first delete on purpose. A query that throws here must
 * abort the sweep rather than leave it deleting against a half-built set — that is the one way
 * this function could destroy a file the user still has a row for.
 */
export async function pruneBlobs(db: Database): Promise<void> {
  const keep = new Set((await listSourceFiles(db)).map((s) => genomeBlobName(s.sha256)))
  for (const [pid, n] of Object.entries(await genotypeCounts(db))) keep.add(rebuiltBlobName(pid, n))
  for (const sha of await attachmentShas(db)) keep.add(attachmentBlobName(sha))
  for (const name of await db.fileList()) {
    if (/^(genome-|generic-|att-)/.test(name) && !keep.has(name)) await db.fileDelete(name)
  }
}

export async function listSourceFiles(db: Database): Promise<SourceFile[]> {
  const rows = await db.query('SELECT * FROM source_file ORDER BY imported_at')
  return rows.map((r) => ({
    id: r.id as string,
    personId: r.person_id as string,
    provider: r.provider as Provider,
    build: r.build as string,
    sha256: r.sha256 as string,
    originalName: r.original_name as string,
    rowCount: r.row_count as number,
    importedAt: r.imported_at as string,
  }))
}

/**
 * Genotype rows per person. Counting scans every row (over a second for a family of genomes), so
 * the result is kept in meta and reused until a write to the genotype table or a person delete
 * drops it (db.worker.ts). Counting and storing is one statement, so no write slips in between.
 */
export async function genotypeCounts(db: Database): Promise<Record<string, number>> {
  const cached = await getMeta(db, 'genotype_counts')
  if (cached !== null) return JSON.parse(cached) as Record<string, number>
  await db.exec(
    `INSERT OR REPLACE INTO meta(key, value)
     SELECT 'genotype_counts', json_group_object(person_id, n)
     FROM (SELECT person_id, COUNT(*) AS n FROM genotype GROUP BY person_id)`,
  )
  return JSON.parse((await getMeta(db, 'genotype_counts')) ?? '{}') as Record<string, number>
}

export interface FamilyCall extends Call {
  personId: string
}

/** The `family_all` query: one rsid across everyone. */
export async function familyAt(db: Database, rsid: string): Promise<FamilyCall[]> {
  const rows = await db.query(
    'SELECT person_id, rsid, chromosome, position, a1, a2 FROM genotype WHERE rsid = ?',
    [rsid.trim()],
  )
  return rows.map(rowToFamilyCall)
}

export async function familyAtMany(db: Database, rsids: string[]): Promise<FamilyCall[]> {
  if (rsids.length === 0) return []
  const out: FamilyCall[] = []
  for (let i = 0; i < rsids.length; i += 500) {
    const slice = rsids.slice(i, i + 500)
    const rows = await db.query(
      `SELECT person_id, rsid, chromosome, position, a1, a2 FROM genotype WHERE rsid IN (${slice.map(() => '?').join(',')})`,
      slice,
    )
    out.push(...rows.map(rowToFamilyCall))
  }
  return out
}

function rowToFamilyCall(r: Row): FamilyCall {
  return {
    personId: r.person_id as string,
    rsid: r.rsid as string,
    chromosome: r.chromosome as string,
    position: r.position as number,
    a1: r.a1 as string,
    a2: r.a2 as string,
  }
}

/** Calls for one person restricted to a list of rsids (kb markers, ask context) — fast via the PK. */
export async function personCallsFor(db: Database, personId: string, rsids: string[]): Promise<Call[]> {
  const out: Call[] = []
  for (let i = 0; i < rsids.length; i += 500) {
    const slice = rsids.slice(i, i + 500)
    const rows = await db.query(
      `SELECT rsid, chromosome, position, a1, a2 FROM genotype WHERE person_id = ? AND rsid IN (${slice.map(() => '?').join(',')})`,
      [personId, ...slice],
    )
    out.push(
      ...rows.map((r) => ({
        rsid: r.rsid as string,
        chromosome: r.chromosome as string,
        position: r.position as number,
        a1: r.a1 as string,
        a2: r.a2 as string,
      })),
    )
  }
  return out
}

/**
 * Mendelian consistency computed inside SQLite (same rule as family/mendelian.ts, which stays as
 * the reference implementation and unit test). Autosomes only, no-calls excluded.
 */
export async function mendelianSql(
  db: Database,
  childId: string,
  parentAId: string,
  parentBId?: string,
): Promise<{ compared: number; violations: number; rate: number }> {
  const autosomal = "c.chromosome NOT IN ('X','Y','XY','MT') AND c.a1 <> '-' AND c.a2 <> '-'"
  const row = parentBId
    ? await db.one(
        `SELECT COUNT(*) AS compared,
                SUM(CASE WHEN ((c.a1 IN (p.a1,p.a2) AND c.a2 IN (q.a1,q.a2)) OR (c.a2 IN (p.a1,p.a2) AND c.a1 IN (q.a1,q.a2))) THEN 0 ELSE 1 END) AS violations
         FROM genotype c
         JOIN genotype p ON p.rsid = c.rsid AND p.person_id = ?
         JOIN genotype q ON q.rsid = c.rsid AND q.person_id = ?
         WHERE c.person_id = ? AND ${autosomal} AND p.a1 <> '-' AND p.a2 <> '-' AND q.a1 <> '-' AND q.a2 <> '-'`,
        [parentAId, parentBId, childId],
      )
    : await db.one(
        `SELECT COUNT(*) AS compared,
                SUM(CASE WHEN (c.a1 IN (p.a1,p.a2) OR c.a2 IN (p.a1,p.a2)) THEN 0 ELSE 1 END) AS violations
         FROM genotype c
         JOIN genotype p ON p.rsid = c.rsid AND p.person_id = ?
         WHERE c.person_id = ? AND ${autosomal} AND p.a1 <> '-' AND p.a2 <> '-'`,
        [parentAId, childId],
      )
  const compared = (row?.compared as number) ?? 0
  const violations = (row?.violations as number) ?? 0
  return { compared, violations, rate: compared ? violations / compared : 0 }
}

/** Every call for one person. Hundreds of thousands of rows — use only for the dump export. */
export async function personCalls(db: Database, personId: string): Promise<Call[]> {
  const rows = await db.query(
    'SELECT rsid, chromosome, position, a1, a2 FROM genotype WHERE person_id = ? ORDER BY chromosome, position',
    [personId],
  )
  return rows.map((r) => ({
    rsid: r.rsid as string,
    chromosome: r.chromosome as string,
    position: r.position as number,
    a1: r.a1 as string,
    a2: r.a2 as string,
  }))
}

// ---- health log ----------------------------------------------------------------------------

export async function listHealthLog(db: Database, personId: string): Promise<HealthEntry[]> {
  const rows = await db.query(
    'SELECT * FROM health_log WHERE person_id=? ORDER BY date DESC, time DESC, created_at DESC',
    [personId],
  )
  return rows.map(rowToHealthEntry)
}

/** Every person's entries, newest first: the family timeline on the Health page. */
export async function listFamilyHealthLog(db: Database): Promise<HealthEntry[]> {
  const rows = await db.query('SELECT * FROM health_log ORDER BY date DESC, time DESC, created_at DESC')
  return rows.map(rowToHealthEntry)
}

function rowToHealthEntry(r: Row): HealthEntry {
  return {
    id: r.id as string,
    personId: r.person_id as string,
    date: r.date as string,
    time: normTime((r.time as string) ?? ''),
    kind: r.kind as HealthKind,
    title: r.title as string,
    body: r.body as string,
    source: r.source as string,
    bodyPart: r.body_part as string,
    severity: (r.severity as number | null) ?? null,
    tags: parseTags(r.tags as string),
    value: (r.value as number | null) ?? null,
    value2: (r.value2 as number | null) ?? null,
    unit: (r.unit as string) ?? '',
    createdAt: r.created_at as string,
  }
}

export async function addHealthEntry(
  db: Database,
  e: {
    personId: string
    date: string
    time?: string
    kind: HealthKind
    title: string
    body: string
    source?: string
    bodyPart?: string
    severity?: number | null
    tags?: string[]
    value?: number | null
    value2?: number | null
    unit?: string
  },
): Promise<HealthEntry> {
  const entry: HealthEntry = {
    id: newId(),
    createdAt: now(),
    time: '',
    source: '',
    bodyPart: '',
    severity: null,
    tags: [],
    value: null,
    value2: null,
    unit: '',
    ...e,
  }
  entry.bodyPart = entry.bodyPart.trim().toLowerCase()
  entry.tags = parseTags(formatTags(entry.tags))
  entry.unit = entry.unit.trim()
  entry.time = normTime(entry.time)
  await db.exec(
    'INSERT INTO health_log(id,person_id,date,time,kind,title,body,source,body_part,severity,tags,value,value2,unit,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      entry.id,
      entry.personId,
      entry.date,
      entry.time,
      entry.kind,
      entry.title,
      entry.body,
      entry.source,
      entry.bodyPart,
      entry.severity,
      formatTags(entry.tags),
      entry.value,
      entry.value2,
      entry.unit,
      entry.createdAt,
    ],
  )
  return entry
}

export async function deleteHealthEntry(db: Database, id: string): Promise<void> {
  await db.exec('DELETE FROM health_log WHERE id=?', [id])
  // The attachment rows go with the entry (ON DELETE CASCADE); their blobs need collecting.
  await pruneBlobs(db)
}

// ---- attachments ---------------------------------------------------------------------------

function rowToAttachment(r: Row): Attachment {
  return {
    id: r.id as string,
    healthLogId: r.health_log_id as string,
    personId: r.person_id as string,
    sha256: r.sha256 as string,
    mime: r.mime as string,
    bytes: r.bytes as number,
    name: r.name as string,
    createdAt: r.created_at as string,
  }
}

/** Every entry's attachments in one query, keyed by entry id; entries with none are absent. */
export async function listAttachments(
  db: Database,
  entryIds: string[],
): Promise<Record<string, Attachment[]>> {
  const out: Record<string, Attachment[]> = {}
  for (let i = 0; i < entryIds.length; i += 500) {
    const slice = entryIds.slice(i, i + 500)
    const rows = await db.query(
      `SELECT * FROM attachment WHERE health_log_id IN (${slice.map(() => '?').join(',')})
       ORDER BY created_at`,
      slice,
    )
    for (const r of rows) {
      const a = rowToAttachment(r)
      const list = out[a.healthLogId]
      if (list) list.push(a)
      else out[a.healthLogId] = [a]
    }
  }
  return out
}

export async function insertAttachment(db: Database, a: Attachment): Promise<void> {
  await db.exec(
    'INSERT INTO attachment(id,health_log_id,person_id,sha256,mime,bytes,name,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [a.id, a.healthLogId, a.personId, a.sha256, a.mime, a.bytes, a.name, a.createdAt],
  )
}

export async function deleteAttachment(db: Database, id: string): Promise<void> {
  await db.exec('DELETE FROM attachment WHERE id=?', [id])
}

/** Every distinct blob an attachment row refers to: the prune keep-set and the mirror's wanted set. */
export async function attachmentShas(db: Database): Promise<string[]> {
  const rows = await db.query('SELECT DISTINCT sha256 FROM attachment ORDER BY sha256')
  return rows.map((r) => r.sha256 as string)
}

/** Rows, distinct blobs and the bytes those blobs occupy (a document attached twice counts once). */
export async function countAttachments(
  db: Database,
): Promise<{ rows: number; blobs: number; bytes: number }> {
  const row = await db.one(
    `SELECT (SELECT COUNT(*) FROM attachment) AS rows,
            COUNT(*) AS blobs, COALESCE(SUM(bytes), 0) AS bytes
     FROM (SELECT sha256, MAX(bytes) AS bytes FROM attachment GROUP BY sha256)`,
  )
  return {
    rows: (row?.rows as number) ?? 0,
    blobs: (row?.blobs as number) ?? 0,
    bytes: (row?.bytes as number) ?? 0,
  }
}

// ---- consent / sharing log / meta -----------------------------------------------------------

/** Keys the user's own provider credentials live under. Never exported in a dump. */
export const META_GEMINI_KEY = 'gemini_api_key'
export const META_GEMINI_MODEL = 'gemini_model'

export async function getMeta(db: Database, key: string): Promise<string | null> {
  const row = await db.one('SELECT value FROM meta WHERE key=?', [key])
  return (row?.value as string | undefined) ?? null
}

export async function setMeta(db: Database, key: string, value: string | null): Promise<void> {
  if (value === null || value === '') await db.exec('DELETE FROM meta WHERE key=?', [key])
  else await db.exec('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)', [key, value])
}

export async function eraseEverything(db: Database): Promise<void> {
  for (const t of [
    'sharing_log',
    'chat',
    'note',
    'consent',
    'attachment',
    'health_log',
    'genotype',
    'source_file',
    'relationship',
    'person',
  ]) {
    await db.exec(`DELETE FROM ${t}`)
  }
  await db.exec("DELETE FROM meta WHERE key NOT IN ('schema_version', 'device')")
  await pruneBlobs(db)
}

export async function logSharing(
  db: Database,
  kind: string,
  destination: string,
  payload: string,
): Promise<void> {
  await db.exec('INSERT INTO sharing_log(kind,destination,payload,created_at) VALUES (?,?,?,?)', [
    kind,
    destination,
    payload,
    now(),
  ])
}

export async function listSharing(
  db: Database,
): Promise<{ id: number; kind: string; destination: string; payload: string; createdAt: string }[]> {
  const rows = await db.query('SELECT * FROM sharing_log ORDER BY id DESC LIMIT 200')
  return rows.map((r) => ({
    id: r.id as number,
    kind: r.kind as string,
    destination: r.destination as string,
    payload: r.payload as string,
    createdAt: r.created_at as string,
  }))
}
