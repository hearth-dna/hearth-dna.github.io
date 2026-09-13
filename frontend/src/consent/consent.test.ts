import { describe, expect, it } from 'vitest'
import type { Database } from '../db/db'
import { revokeConsent } from './consent'

/** Records every statement; enough to assert what revoke touches. */
function fakeDb() {
  const log: [string, unknown[] | undefined][] = []
  const db = {
    exec: async (sql: string, bind?: unknown[]) => void log.push([sql, bind]),
  } as unknown as Database
  return { db, log }
}

describe('revokeConsent', () => {
  it('deletes the genome and both genome consents for the subject', async () => {
    const { db, log } = fakeDb()
    await revokeConsent(db, 'import_genome', 'p1')
    expect(log.map(([sql]) => sql.split(' ')[2])).toEqual(['genotype', 'source_file', 'consent'])
    expect(log.every(([, bind]) => bind?.[0] === 'p1')).toBe(true)
    expect(log[2][0]).toContain("'import_genome','import_minor'")
  })
  it('deletes the health log with a document consent', async () => {
    const { db, log } = fakeDb()
    await revokeConsent(db, 'import_document', 'p1')
    expect(log.map(([sql]) => sql.split(' ')[2])).toEqual(['health_log', 'consent'])
    expect(log[0][1]).toEqual(['p1'])
  })
  it('deletes only the record for other kinds', async () => {
    const { db, log } = fakeDb()
    await revokeConsent(db, 'first_launch')
    expect(log).toEqual([['DELETE FROM consent WHERE kind=? AND subject=?', ['first_launch', '']]])
  })
})
