import type { Call, Person, Provider, Sex, SourceFile } from '../types'
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

export async function deletePerson(db: Database, id: string): Promise<void> {
  await db.exec('DELETE FROM person WHERE id = ?', [id])
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
  await db.exec(
    'INSERT INTO source_file(id,person_id,provider,build,sha256,original_name,row_count,imported_at) VALUES (?,?,?,?,?,?,?,?)',
    [sf.id, sf.personId, sf.provider, sf.build, sf.sha256, sf.originalName, sf.rowCount, sf.importedAt],
  )
  return sf
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

export async function genotypeCounts(db: Database): Promise<Record<string, number>> {
  const rows = await db.query('SELECT person_id, COUNT(*) AS n FROM genotype GROUP BY person_id')
  return Object.fromEntries(rows.map((r) => [r.person_id as string, r.n as number]))
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

// ---- consent / sharing log / meta -----------------------------------------------------------

export async function eraseEverything(db: Database): Promise<void> {
  for (const t of [
    'sharing_log',
    'chat',
    'note',
    'consent',
    'genotype',
    'source_file',
    'relationship',
    'person',
  ]) {
    await db.exec(`DELETE FROM ${t}`)
  }
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
