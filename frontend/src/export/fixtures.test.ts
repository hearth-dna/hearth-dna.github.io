import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type Container, openContainer, serialiseContainer } from './container'

/**
 * The golden backups the native apps test their restore against (ADR 0010): written by this code,
 * committed under mobile/fixtures/, and checked here so the web keeps opening them too. The data
 * is invented. `UPDATE_FIXTURES=1 npx vitest run src/export/fixtures.test.ts` rewrites them.
 */
const DIR = `${__dirname}/../../../mobile/fixtures`
const FIXTURE_PASSPHRASE = 'correct horse battery staple'

const journal: Container['journal'] = {
  persons: [
    {
      id: 'p-alex',
      label: 'alex',
      display_name: 'Alex',
      sex: 'female',
      birth_year: 1961,
      notes: '',
      created_at: '2026-01-02T10:00:00.000Z',
    },
    {
      id: 'p-sam',
      label: 'sam',
      display_name: 'Sam',
      sex: 'male',
      birth_year: 1990,
      notes: 'second child',
      created_at: '2026-01-02T10:05:00.000Z',
    },
  ],
  relationships: [{ parentId: 'p-alex', childId: 'p-sam' }],
  source_files: [],
  consents: [
    { kind: 'first_launch', version: 1, subject: '', grantedAt: '2026-01-02T09:59:00.000Z' },
    { kind: 'import_document', version: 1, subject: 'p-alex', grantedAt: '2026-01-03T08:00:00.000Z' },
  ],
  health_log: [
    {
      id: 'h-1',
      person_id: 'p-alex',
      date: '2026-09-14',
      time: '08:05',
      kind: 'measurement',
      title: 'Blood pressure',
      body: '',
      source: '',
      body_part: '',
      severity: null,
      tags: '',
      value: 128,
      value2: 84,
      unit: 'mmHg',
      created_at: '2026-09-14T06:05:00.000Z',
    },
    {
      id: 'h-2',
      person_id: 'p-alex',
      date: '2026-09-14',
      time: '',
      kind: 'symptom',
      title: 'Pain in both hands',
      body: 'Worse in the morning.\nEased by noon.',
      source: '',
      body_part: 'hands',
      severity: 6,
      tags: 'arthritis, flare',
      value: null,
      value2: null,
      unit: '',
      created_at: '2026-09-14T09:00:00.000Z',
    },
    {
      id: 'h-3',
      person_id: 'p-sam',
      date: '2026-08-30',
      time: '21:40',
      kind: 'measurement',
      title: 'Body temperature',
      body: '',
      source: '',
      body_part: '',
      severity: null,
      tags: '',
      value: 38.4,
      value2: null,
      unit: '°C',
      created_at: '2026-08-30T19:40:00.000Z',
    },
    {
      id: 'h-4',
      person_id: 'p-sam',
      date: '2026-07-01',
      kind: 'lab',
      title: 'Complete blood count',
      body: 'Hb 14.1 g/dL (13.5–17.5)',
      source: 'gemini-2.5-flash:2026-07-01',
      created_at: '2026-07-01T12:00:00.000Z',
    },
  ],
  attachments: [
    {
      id: 'a-1',
      health_log_id: 'h-4',
      person_id: 'p-sam',
      sha256: '0'.repeat(64),
      mime: 'application/pdf',
      bytes: 1234,
      name: 'cbc.pdf',
      created_at: '2026-07-01T12:00:00.000Z',
    },
  ],
  notes: [
    {
      id: 'n-1',
      person_id: 'p-alex',
      topic: 'rs429358',
      markdown: 'Ask at the next check-up.',
      updated_at: '2026-02-01T00:00:00.000Z',
    },
  ],
  chats: [],
  sharing_log: [
    { kind: 'ask', destination: 'gemini', payload: '{"n":1}', created_at: '2026-03-01T00:00:00.000Z' },
  ],
}

const container: Container = {
  header: {
    format: 'hearth-dump',
    version: 2,
    generation: 7,
    device: 'fixture-device',
    exported_at: '2026-09-21T00:00:00.000Z',
    encrypted: false,
  },
  manifest: { app_version: 'fixture', profile: 'default', genomes: [] },
  journal,
  genomes: {},
}

describe('mobile fixtures', () => {
  if (process.env.UPDATE_FIXTURES) {
    it('writes them', async () => {
      if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
      writeFileSync(`${DIR}/plain.hearth`, await serialiseContainer(container))
      writeFileSync(`${DIR}/encrypted.hearth`, await serialiseContainer(container, FIXTURE_PASSPHRASE))
      writeFileSync(`${DIR}/journal.json`, `${JSON.stringify(journal, null, 2)}\n`)
    })
    return
  }
  it('open to the committed journal, plain and encrypted', async () => {
    const expected = JSON.parse(readFileSync(`${DIR}/journal.json`, 'utf8'))
    expect(expected).toEqual(journal)
    const plain = await openContainer(new Uint8Array(readFileSync(`${DIR}/plain.hearth`)))
    expect(plain.journal).toEqual(journal)
    expect(plain.header.generation).toBe(7)
    const enc = await openContainer(
      new Uint8Array(readFileSync(`${DIR}/encrypted.hearth`)),
      FIXTURE_PASSPHRASE,
    )
    expect(enc.header.encrypted).toBe(true)
    expect(enc.journal).toEqual(journal)
  }, 20_000)
})
