import type { Database } from '../db/db'
import { now } from '../db/repo'
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

export async function revokeConsent(db: Database, kind: ConsentKind, subject = ''): Promise<void> {
  await db.exec('UPDATE consent SET revoked_at=? WHERE kind=? AND subject=? AND revoked_at IS NULL', [
    now(),
    kind,
    subject,
  ])
}

export async function listConsents(
  db: Database,
): Promise<
  { kind: ConsentKind; version: number; subject: string; grantedAt: string; revokedAt: string | null }[]
> {
  const rows = await db.query(
    'SELECT kind, version, subject, granted_at, revoked_at FROM consent ORDER BY id DESC',
  )
  return rows.map((r) => ({
    kind: r.kind as ConsentKind,
    version: r.version as number,
    subject: r.subject as string,
    grantedAt: r.granted_at as string,
    revokedAt: (r.revoked_at as string | null) ?? null,
  }))
}
