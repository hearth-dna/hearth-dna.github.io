import { listConsents } from '../consent/consent'
import type { Database } from '../db/db'
import { listSharing, listSourceFiles, personCalls } from '../db/repo'
import type { Call, Person } from '../types'
import { buildDump, serialiseDump } from './dump'

/**
 * Builds the full dump and hands it to the browser as a download. Shared by Settings and the
 * erase dialog, so "export before you erase" is the same file as a normal backup.
 */
export async function exportDumpFile(
  db: Database,
  appVersion: string,
  persons: Person[],
  relationships: { parentId: string; childId: string }[],
  passphrase?: string,
): Promise<string> {
  const callsByPerson: Record<string, Call[]> = {}
  for (const p of persons) callsByPerson[p.id] = await personCalls(db, p.id)
  const dump = buildDump({
    appVersion,
    persons,
    relationships,
    sourceFiles: await listSourceFiles(db),
    callsByPerson,
    consents: await listConsents(db),
    sharingLog: await listSharing(db),
    healthLog: await db.query('SELECT * FROM health_log'),
    notes: await db.query('SELECT * FROM note'),
    chats: await db.query('SELECT * FROM chat'),
  })
  const bytes = await serialiseDump(dump, passphrase || undefined)
  const name = `hearth-dump-${new Date().toISOString().slice(0, 10)}.json.gz${passphrase ? '.enc' : ''}`
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
  return `Exported ${name} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)${passphrase ? ', encrypted' : ' — plaintext genetic data, keep it safe'}`
}
