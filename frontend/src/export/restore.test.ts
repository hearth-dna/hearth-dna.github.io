import { describe, expect, it } from 'vitest'
import type { Database } from '../db/db'
import { type Container, serialiseContainer } from './container'
import { restoreBytes } from './restore'

/** Records every statement; enough to assert what a restore writes. */
function fakeDb() {
  const log: [string, unknown[] | undefined][] = []
  const db = {
    exec: async (sql: string, bind?: unknown[]) => void log.push([sql, bind]),
    query: async () => [],
    one: async () => undefined,
    filePut: async () => {},
    fileGet: async () => null,
    fileList: async () => [],
    fileDelete: async () => {},
  } as unknown as Database
  return { db, log }
}

const container = (attachments: unknown[]): Container => ({
  header: {
    format: 'hearth-dump',
    version: 2,
    generation: 1,
    device: 'dev-1',
    exported_at: '2026-09-20T00:00:00Z',
    encrypted: false,
  },
  manifest: { app_version: '0.1.0', profile: 'default', genomes: [] },
  journal: {
    persons: [{ id: 'p1' }],
    relationships: [],
    source_files: [],
    consents: [],
    health_log: [{ id: 'h1', person_id: 'p1', date: '2026-09-20', kind: 'lab', title: 'FBC', body: '' }],
    attachments,
    notes: [],
    chats: [],
    sharing_log: [],
  },
  genomes: {},
})

const row = {
  id: 'a1',
  health_log_id: 'h1',
  person_id: 'p1',
  sha256: 'ab',
  mime: 'application/pdf',
  bytes: 4096,
  name: 'blood-count.pdf',
  created_at: 'c',
}

describe('restoring attachments', () => {
  it('inserts the rows from the allowlist, after their entries', async () => {
    const { db, log } = fakeDb()
    await restoreBytes(db, await serialiseContainer(container([row])), undefined)
    const health = log.findIndex(([sql]) => sql.includes('INTO health_log'))
    const attachment = log.findIndex(([sql]) => sql.includes('INTO attachment'))
    expect(health).toBeGreaterThanOrEqual(0)
    expect(attachment).toBeGreaterThan(health)
    expect(log[attachment][0]).toContain('id,health_log_id,person_id,sha256,mime,bytes,name,created_at')
    // The last bind is the entry the guard looks for, so there is one more bind than columns.
    expect(log[attachment][1]).toEqual([
      'a1',
      'h1',
      'p1',
      'ab',
      'application/pdf',
      4096,
      'blood-count.pdf',
      'c',
      'h1',
    ])
  })

  it('guards against a row whose entry is not in the file', async () => {
    // INSERT OR IGNORE does not cover foreign-key violations, so the statement itself must skip.
    const { db, log } = fakeDb()
    await restoreBytes(
      db,
      await serialiseContainer(container([{ ...row, health_log_id: 'gone' }])),
      undefined,
    )
    const [sql, bind] = log.find(([s]) => s.includes('INTO attachment')) ?? ['', []]
    expect(sql).toContain('WHERE EXISTS (SELECT 1 FROM health_log WHERE id = ?)')
    expect(bind?.at(-1)).toBe('gone')
  })

  it('accepts a dump written before attachments existed', async () => {
    const { db, log } = fakeDb()
    const c = container([])
    c.journal.attachments = undefined
    await restoreBytes(db, await serialiseContainer(c), undefined)
    expect(log.some(([sql]) => sql.includes('INTO attachment'))).toBe(false)
  })
})
