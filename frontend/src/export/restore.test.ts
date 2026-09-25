import { describe, expect, it } from 'vitest'
import type { Database } from '../db/db'
import { type Container, genomePath } from './container'
import { restoreContainer } from './restore'

/** Records every statement; an empty database for every query. */
function fakeDb() {
  const log: string[] = []
  const db = {
    exec: async (sql: string) => void log.push(sql),
    query: async () => [],
  } as unknown as Database
  return { db, log }
}

const container = (): Container => ({
  header: {
    format: 'hearth-dump',
    version: 2,
    generation: 1,
    device: 'dev',
    exported_at: '2026-09-21T16:14:00Z',
    encrypted: false,
  },
  manifest: {
    app_version: '0',
    profile: 'default',
    genomes: [
      {
        path: genomePath('ab'),
        sha256: 'ab',
        person_id: 'p1',
        source_file_id: null,
        provider: 'generic',
        build: '37',
        kind: 'reconstructed',
      },
    ],
  },
  journal: {
    persons: [
      {
        id: 'p1',
        label: 'mother',
        display_name: 'Ann',
        sex: 'F',
        birth_year: null,
        notes: '',
        created_at: 't',
      },
    ],
    relationships: [],
    source_files: [],
    consents: [],
    health_log: [],
    notes: [],
    chats: [],
    sharing_log: [],
  },
  genomes: {},
})

describe('restoreContainer', () => {
  it('restores everything else and names the people whose genome file is missing', async () => {
    const { db, log } = fakeDb()
    const r = await restoreContainer(db, container())
    expect(r.missing).toEqual([{ id: 'p1', name: 'Ann' }])
    expect(r.genomes).toBe(0)
    expect(log.some((sql) => sql.includes('INTO person'))).toBe(true)
  })
})
