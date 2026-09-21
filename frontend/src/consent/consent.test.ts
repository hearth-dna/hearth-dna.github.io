import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../db/db'
import { grantConsent, hasConsent, revokeConsent } from './consent'

/** Records every statement; enough to assert what revoke touches. */
function fakeDb() {
  const log: [string, unknown[] | undefined][] = []
  const db = {
    exec: async (sql: string, bind?: unknown[]) => void log.push([sql, bind]),
    query: async () => [],
    fileList: async () => [],
    fileDelete: async () => {},
    one: async () => undefined, // no consent in force unless a test overrides it
  } as unknown as Database
  return { db, log }
}

/** Minimal localStorage; node has none. */
function fakeStorage() {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  })
  vi.stubGlobal('location', { search: '' })
  return m
}

afterEach(() => vi.unstubAllGlobals())

describe('first_launch consent mirror', () => {
  it('survives a database that forgot it', async () => {
    const m = fakeStorage()
    const { db, log } = fakeDb()
    await grantConsent(db, 'first_launch')
    expect([...m.keys()]).toEqual(['hearth:default:first_launch:v1'])
    const at = [...m.values()][0]
    // A fresh memory database has no row: the mirror re-seeds it with the original timestamp.
    ;(db as { one?: unknown }).one = async () => undefined
    expect(await hasConsent(db, 'first_launch')).toBe(true)
    expect(log.at(-1)).toEqual([expect.stringContaining('INSERT INTO consent'), ['first_launch', 1, '', at]])
  })
  it('is cleared by revoke and does not seed other kinds', async () => {
    const m = fakeStorage()
    const { db } = fakeDb()
    ;(db as { one?: unknown }).one = async () => undefined
    await grantConsent(db, 'first_launch')
    await grantConsent(db, 'tier3_byok')
    await revokeConsent(db, 'first_launch')
    expect(m.size).toBe(0)
    expect(await hasConsent(db, 'first_launch')).toBe(false)
    expect(await hasConsent(db, 'tier3_byok')).toBe(false)
  })
})

describe('grantConsent', () => {
  it('does not insert when a record is already in force', async () => {
    fakeStorage()
    const { db, log } = fakeDb()
    ;(db as { one?: unknown }).one = async () => ({ ok: 1 })
    await grantConsent(db, 'import_genome', 'p1')
    expect(log).toEqual([])
  })
})

describe('revokeConsent', () => {
  it('deletes the genome and both genome consents for the subject', async () => {
    const { db, log } = fakeDb()
    await revokeConsent(db, 'import_genome', 'p1')
    // Cleanup afterwards re-reads genotype counts, which re-fills their cache in meta.
    const deletes = log.filter(([sql]) => sql.startsWith('DELETE'))
    expect(deletes.map(([sql]) => sql.split(' ')[2])).toEqual(['genotype', 'source_file', 'consent'])
    expect(deletes.every(([, bind]) => bind?.[0] === 'p1')).toBe(true)
    expect(deletes[2][0]).toContain("'import_genome','import_minor'")
  })
  it('deletes the health log with a document consent, and collects its documents', async () => {
    const { db, log } = fakeDb()
    await revokeConsent(db, 'import_document', 'p1')
    const deletes = log.filter(([sql]) => sql.startsWith('DELETE'))
    expect(deletes.map(([sql]) => sql.split(' ')[2])).toEqual(['health_log', 'consent'])
    expect(deletes[0][1]).toEqual(['p1'])
    // The attachment rows go with the entries; their blobs need the sweep, which re-reads the
    // genotype counts on its way past.
    expect(log.some(([sql]) => sql.includes('genotype_counts'))).toBe(true)
  })
  it('deletes only the record for other kinds', async () => {
    const { db, log } = fakeDb()
    await revokeConsent(db, 'first_launch')
    expect(log).toEqual([['DELETE FROM consent WHERE kind=? AND subject=?', ['first_launch', '']]])
  })
})
