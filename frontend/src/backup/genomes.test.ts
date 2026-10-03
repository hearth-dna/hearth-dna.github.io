import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { isEncrypted, sealer } from '../attachments/crypto'
import type { Database } from '../db/db'
import { sha256 } from '../export/container'
import { sha256Hex } from '../import/unpack'
import type { Dir } from './folder'
import { genomeLoader, mirrorGenomes, pickFor, readPickedGenomes } from './genomes'

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
  const text = 'rs1\t1\t100\tAG\n'
  const gz = gzipSync(strToU8(text))
  const waiting = async () => ({
    entry: { ...entry, sha256: await sha256(gz) },
    name: 'Alex',
    textSha: await sha256Hex(text),
  })

  it('are matched by their bytes, whatever they are called', async () => {
    const picked = await readPickedGenomes([new Uint8Array([1, 2, 3]), gz], null)
    expect(pickFor(await waiting(), picked)).toBe(1)
  })

  it('are matched by the text inside when the copy was decompressed or compressed again', async () => {
    const again = gzipSync(strToU8(text), { level: 1, mtime: 1 })
    for (const copy of [strToU8(text), again]) {
      const picked = await readPickedGenomes([copy], null)
      expect(pickFor(await waiting(), picked)).toBe(0)
      expect(strFromU8(gunzipSync((picked[0] as { gz: Uint8Array }).gz))).toBe(text)
    }
    expect(
      pickFor({ ...(await waiting()), textSha: undefined }, await readPickedGenomes([again], null)),
    ).toBe(-1)
  })

  it('are opened with the passphrase when sealed, and need it', async () => {
    const sealed = await (await sealer('correct horse'))(gz)
    expect(pickFor(await waiting(), await readPickedGenomes([sealed], 'correct horse'))).toBe(0)
    expect(await readPickedGenomes([sealed], 'wrong')).toEqual([null])
    await expect(readPickedGenomes([sealed], null)).rejects.toThrow(/passphrase/)
  })
})
