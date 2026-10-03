import { describe, expect, it } from 'vitest'
import { isEncrypted, sealer } from '../attachments/crypto'
import type { Database } from '../db/db'
import { sha256 } from '../export/container'
import type { Dir } from './folder'
import { genomeLoader, matchGenomeFiles, mirrorGenomes } from './genomes'

/** A folder in memory, with a count of writes so "written once" can be asserted. */
function memoryDir(name = 'root'): Dir & { files: Map<string, Uint8Array>; writes: () => number } {
  const files = new Map<string, Uint8Array>()
  const subs = new Map<string, ReturnType<typeof memoryDir>>()
  let writes = 0
  return {
    name,
    files,
    writes: () => writes + [...subs.values()].reduce((n, s) => n + s.writes(), 0),
    names: async () => [...files.keys(), ...subs.keys()],
    read: async (n) => files.get(n) ?? null,
    readHead: async (n, b) => files.get(n)?.subarray(0, b) ?? null,
    write: async (n, bytes) => {
      writes++
      files.set(n, typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes)
    },
    remove: async (n) => void (files.delete(n) || subs.delete(n)),
    subdir: async (n, create = false) => {
      if (!subs.has(n) && create) subs.set(n, memoryDir(n))
      return subs.get(n) ?? null
    },
  }
}

const cache = new Map([['genome-abc', new Uint8Array([31, 139, 8, 0, 1, 2, 3])]])
const db = { fileGet: async (name: string) => cache.get(name) ?? null } as unknown as Database
const files = [{ path: 'genomes/1111.txt.gz', blob: 'genome-abc' }]
const entry = {
  path: 'genomes/1111.txt.gz',
  sha256: '1111',
  person_id: 'p1',
  source_file_id: 's1',
  provider: 'generic' as const,
  build: '37',
  kind: 'original' as const,
}

describe('genome files beside a folder snapshot', () => {
  it('writes each genome once and reads it back', async () => {
    const dir = memoryDir()
    expect(await mirrorGenomes(dir, db, 'default', files, null)).toBe(1)
    expect(await mirrorGenomes(dir, db, 'default', files, null)).toBe(0)
    expect(dir.writes()).toBe(1)
    const load = await genomeLoader(dir, 'default', null)
    expect(await load(entry)).toEqual(cache.get('genome-abc'))
    expect(await load({ ...entry, path: 'genomes/2222.txt.gz' })).toBeNull()
  })

  it('encrypts them with the passphrase and needs it to read them', async () => {
    const dir = memoryDir()
    await mirrorGenomes(dir, db, 'family-b', files, 'correct horse')
    const sub = await dir.subdir('genomes-family-b')
    expect(isEncrypted((await sub?.read('1111.txt.gz')) ?? new Uint8Array())).toBe(true)
    expect(await (await genomeLoader(dir, 'family-b', 'correct horse'))(entry)).toEqual(
      cache.get('genome-abc'),
    )
    await expect((await genomeLoader(dir, 'family-b', null))(entry)).rejects.toThrow(/passphrase/)
  })
})

describe('genome files picked by hand', () => {
  const gz = new Uint8Array([31, 139, 8, 0, 9, 9, 9])
  const other = new Uint8Array([31, 139, 8, 0, 7, 7, 7])
  const forBytes = async (bytes: Uint8Array) => ({ ...entry, sha256: await sha256(bytes) })

  it('matches them to the snapshot by content, whatever they are called', async () => {
    const e = await forBytes(gz)
    const r = await matchGenomeFiles([other, gz], [e], null)
    expect(r.found).toEqual([{ entry: e, gz }])
    expect(r.unmatched).toBe(1)
  })

  it('opens encrypted ones with the passphrase, and needs it', async () => {
    const e = await forBytes(gz)
    const sealed = await (await sealer('correct horse'))(gz)
    expect((await matchGenomeFiles([sealed], [e], 'correct horse')).found).toEqual([{ entry: e, gz }])
    expect((await matchGenomeFiles([sealed], [e], 'wrong')).unmatched).toBe(1)
    await expect(matchGenomeFiles([sealed], [e], null)).rejects.toThrow(/passphrase/)
  })
})
