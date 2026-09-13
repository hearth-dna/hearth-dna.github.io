import type { Database } from '../db/db'
import { META_GEMINI_KEY, now, setMeta } from '../db/repo'
import { CONSENTS, type ConsentKind } from './kinds'

export async function hasConsent(db: Database, kind: ConsentKind, subject = ''): Promise<boolean> {
  const row = await db.one(
    'SELECT 1 AS ok FROM consent WHERE kind=? AND version=? AND subject=? AND revoked_at IS NULL LIMIT 1',
    [kind, CONSENTS[kind].version, subject],
  )
  return row !== undefined
}

export async function grantConsent(db: Database, kind: ConsentKind, subject = ''): Promise<void> {
  await db.exec('INSERT INTO consent(kind,version,subject,granted_at) VALUES (?,?,?,?)', [
    kind,
    CONSENTS[kind].version,
    subject,
    now(),
  ])
}

/** Whether revoking `kind` deletes the subject's genome (both genome consents cover the same data). */
export const revokeDeletesGenome = (kind: ConsentKind) => kind === 'import_genome' || kind === 'import_minor'

/** Whether revoking `kind` destroys data (used for the confirm prompt). */
export const revokeDeletesData = (kind: ConsentKind) =>
  revokeDeletesGenome(kind) || kind === 'import_document'

/**
 * Revoking is deletion: the record goes, and so does everything the consent covered. For a genome
 * consent that is the person's genotypes and source files; for a document consent, their health
 * log. The person, notes and pedigree stay.
 */
export async function revokeConsent(db: Database, kind: ConsentKind, subject = ''): Promise<void> {
  if (kind === 'import_document') await db.exec('DELETE FROM health_log WHERE person_id=?', [subject])
  if (kind === 'read_document_byok') await setMeta(db, META_GEMINI_KEY, null)
  if (revokeDeletesGenome(kind)) {
    await db.exec('DELETE FROM genotype WHERE person_id=?', [subject])
    await db.exec('DELETE FROM source_file WHERE person_id=?', [subject])
    await db.exec("DELETE FROM consent WHERE kind IN ('import_genome','import_minor') AND subject=?", [
      subject,
    ])
    return
  }
  await db.exec('DELETE FROM consent WHERE kind=? AND subject=?', [kind, subject])
}

export async function listConsents(
  db: Database,
): Promise<{ kind: ConsentKind; version: number; subject: string; grantedAt: string }[]> {
  const rows = await db.query('SELECT kind, version, subject, granted_at FROM consent ORDER BY id DESC')
  return rows.map((r) => ({
    kind: r.kind as ConsentKind,
    version: r.version as number,
    subject: r.subject as string,
    grantedAt: r.granted_at as string,
  }))
}
