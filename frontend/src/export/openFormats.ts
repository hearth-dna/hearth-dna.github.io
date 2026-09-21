import type { Database } from '../db/db'
import { listAttachments, listHealthLog, personCallsFor } from '../db/repo'
import { computeFindings, type Kb } from '../kb/kb'
import type { Person } from '../types'
import { downloadBytes } from './exportDump'
import { findingsTable, healthTable, type OpenFormat, openFileName, personColumns, render } from './table'

/**
 * Downloads one of the open-format files (docs/architecture/storage/open-formats.md). Each
 * returns the file name and size so the card can report it. Plaintext by design: these files
 * are for the user's own spreadsheet or scripts, and the card says so.
 */
export interface Exported {
  name: string
  bytes: number
  rows: number
}

const text = (s: string) => new TextEncoder().encode(s)

/** One row per SNP, one genotype column per person; built inside the worker. */
export async function exportGenotypes(
  db: Database,
  persons: Person[],
  format: OpenFormat,
  shared: boolean,
): Promise<Exported> {
  const columns = personColumns(persons)
  const { bytes, rows } = await db.genotypeTable(columns, format, shared)
  const name = openFileName('genotypes', format)
  downloadBytes(bytes, name, format === 'csv' ? 'text/csv' : 'application/x-ndjson')
  return { name, bytes: bytes.length, rows }
}

/** Every knowledge-base finding for every person, with the evidence fields. */
export async function exportFindings(
  db: Database,
  kb: Kb,
  persons: Person[],
  format: OpenFormat,
): Promise<Exported> {
  const rsids = kb.entries.map((e) => e.rsid)
  const byPerson = []
  for (const person of persons)
    byPerson.push({ person, findings: computeFindings(kb, await personCallsFor(db, person.id, rsids)) })
  const table = findingsTable(byPerson)
  const bytes = text(render(table, format))
  const name = openFileName('findings', format)
  downloadBytes(bytes, name, format === 'csv' ? 'text/csv' : 'application/x-ndjson')
  return { name, bytes: bytes.length, rows: table.rows.length }
}

export async function exportHealthLog(
  db: Database,
  persons: Person[],
  format: OpenFormat,
): Promise<Exported> {
  const byPerson = []
  const ids: string[] = []
  for (const person of persons) {
    const entries = await listHealthLog(db, person.id)
    byPerson.push({ person, entries })
    ids.push(...entries.map((e) => e.id))
  }
  const attachments = await listAttachments(db, ids)
  const counts = Object.fromEntries(Object.entries(attachments).map(([id, a]) => [id, a.length]))
  const table = healthTable(byPerson, counts)
  const bytes = text(render(table, format))
  const name = openFileName('health-log', format)
  downloadBytes(bytes, name, format === 'csv' ? 'text/csv' : 'application/x-ndjson')
  return { name, bytes: bytes.length, rows: table.rows.length }
}
