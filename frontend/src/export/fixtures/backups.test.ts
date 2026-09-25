import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openRepaired } from '../../backup/repair'
import type { Database } from '../../db/db'
import { missingGenomes, openContainer, serialiseContainer } from '../container'
import { restoreBytes, restoreContainer } from '../restore'
import { CHILD, PARENT, PASSPHRASE, ROWS } from './family'

const fixture = (name: string) => new Uint8Array(readFileSync(`${__dirname}/${name}`))
const COMPLETE = fixture('family.hearth')
const MISSING = fixture('family-missing-genome.hearth')
const MISSING_ENC = fixture('family-missing-genome.hearth.enc')

/** An empty database that records what a restore writes. */
function fakeDb() {
  const sql: string[] = []
  const genotypes: Record<string, number> = {}
  const db = {
    exec: async (s: string) => void sql.push(s),
    query: async () => [],
    bulkInsert: async (_table: string, _cols: string[], rows: unknown[][]) => {
      for (const r of rows) genotypes[r[0] as string] = (genotypes[r[0] as string] ?? 0) + 1
    },
    filePut: async () => {},
  } as unknown as Database
  const inserted = (table: string) => sql.filter((s) => s.includes(`INTO ${table}`)).length
  return { db, genotypes, inserted }
}

describe('backup fixtures', () => {
  it('restores the complete family', async () => {
    const { db, genotypes, inserted } = fakeDb()
    const r = await restoreBytes(db, COMPLETE, undefined)
    expect(r).toMatchObject({ genomes: 2, missing: [], version: 2 })
    expect(genotypes).toEqual({ [PARENT.id]: ROWS, [CHILD.id]: ROWS })
    expect(inserted('person')).toBe(2)
    expect(inserted('relationship')).toBe(1)
    expect(inserted('health_log')).toBe(1)
  })

  it('restores a backup that lost a genome file, and names who is missing', async () => {
    // The shape of the file that failed on the Mac: manifest lists two genomes, zip carries one.
    const c = await openContainer(MISSING)
    expect(c.manifest.genomes).toHaveLength(2)
    expect(missingGenomes(c)).toHaveLength(1)

    const { db, genotypes, inserted } = fakeDb()
    const r = await restoreBytes(db, MISSING, undefined)
    expect(r).toMatchObject({ genomes: 1, missing: [CHILD] })
    expect(genotypes).toEqual({ [PARENT.id]: ROWS })
    expect(inserted('person')).toBe(2)
    expect(inserted('health_log')).toBe(1)
  })

  it('does the same through the encryption envelope', async () => {
    await expect(restoreBytes(fakeDb().db, MISSING_ENC, undefined)).rejects.toThrow(/passphrase/)
    const r = await restoreBytes(fakeDb().db, MISSING_ENC, PASSPHRASE)
    expect(r).toMatchObject({ genomes: 1, missing: [CHILD] })
  })

  it('never writes the broken shape back out', async () => {
    await expect(serialiseContainer(await openContainer(MISSING))).rejects.toThrow(/incomplete/)
  })
})

describe('folder repair with the fixtures', () => {
  const folder = (files: Record<string, Uint8Array>) => {
    const reads: string[] = []
    const read = async (name: string) => {
      reads.push(name)
      return files[name] ?? null
    }
    return { read, reads }
  }

  it('fills the missing genome from an older copy and stops looking', async () => {
    const { read, reads } = folder({ 'hearth-backup.hearth.1': COMPLETE, 'hearth-backup.hearth.2': COMPLETE })
    const c = await openRepaired(
      MISSING,
      undefined,
      ['hearth-backup.hearth.1', 'hearth-backup.hearth.2'],
      read,
    )
    expect(missingGenomes(c)).toEqual([])
    expect(reads).toEqual(['hearth-backup.hearth.1'])

    const { db, genotypes } = fakeDb()
    const r = await restoreContainer(db, c)
    expect(r).toMatchObject({ genomes: 2, missing: [] })
    expect(genotypes).toEqual({ [PARENT.id]: ROWS, [CHILD.id]: ROWS })
  })

  it('skips spares it cannot open or that lack the genome too', async () => {
    const { read, reads } = folder({
      'hearth-backup.hearth.1': MISSING, // same gap
      'hearth-backup.hearth.2': MISSING_ENC, // another passphrase
      'hearth-backup.hearth.3': new Uint8Array([1, 2, 3]), // not a backup
    })
    const names = ['hearth-backup.hearth.1', 'hearth-backup.hearth.2', 'hearth-backup.hearth.3', 'gone']
    const c = await openRepaired(MISSING, undefined, names, read)
    expect(missingGenomes(c)).toHaveLength(1)
    expect(reads).toEqual(names)
    expect((await restoreContainer(fakeDb().db, c)).missing).toEqual([CHILD])
  })

  it('repairs an encrypted snapshot from a plain older copy', async () => {
    const { read } = folder({ 'hearth-backup.hearth.1': COMPLETE })
    const c = await openRepaired(MISSING_ENC, PASSPHRASE, ['hearth-backup.hearth.1'], read)
    expect(missingGenomes(c)).toEqual([])
  })
})
