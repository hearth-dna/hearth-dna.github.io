import { describe, expect, it } from 'vitest'
import type { Call, Person } from '../types'
import { buildDump, deserialiseDump, expandDump, isEncrypted, serialiseDump } from './dump'

const person = (id: string): Person => ({
  id,
  label: id,
  displayName: id,
  sex: 'unknown',
  birthYear: null,
  notes: '',
  createdAt: 't',
})
const c = (rsid: string, chr: string, pos: number, g: string): Call => ({
  rsid,
  chromosome: chr,
  position: pos,
  a1: g[0],
  a2: g[1],
})

describe('dump v1', () => {
  const input = {
    appVersion: '0.1.0',
    persons: [person('p1'), person('p2')],
    relationships: [{ parentId: 'p1', childId: 'p2' }],
    sourceFiles: [],
    callsByPerson: {
      p1: [c('rs1', '1', 10, 'AG'), c('rs2', '1', 20, 'CC'), c('rs3', 'X', 5, 'T-')],
      p2: [c('rs2', '1', 20, 'CT'), c('rs4', '2', 7, 'GG')],
    },
  }

  it('round-trips genotypes through the compact index', () => {
    const d = buildDump(input)
    expect(d.snp_index.rsids).toEqual(['rs1', 'rs2', 'rs3', 'rs4'])
    expect(d.genotypes.p1).toBe('AGCCT---')
    expect(d.genotypes.p2).toBe('--CT--GG')
    const back = expandDump(d)
    expect(back.p1).toEqual(input.callsByPerson.p1)
    expect(back.p2).toEqual(input.callsByPerson.p2)
  })

  it('round-trips through gzip and AES-GCM', async () => {
    const d = buildDump(input)
    const plain = await serialiseDump(d)
    expect(isEncrypted(plain)).toBe(false)
    expect((await deserialiseDump(plain)).persons).toHaveLength(2)

    const enc = await serialiseDump(d, 'correct horse')
    expect(isEncrypted(enc)).toBe(true)
    expect((await deserialiseDump(enc, 'correct horse')).genotypes.p1).toBe('AGCCT---')
    await expect(deserialiseDump(enc, 'wrong')).rejects.toThrow()
    await expect(deserialiseDump(enc)).rejects.toThrow(/passphrase/)
  })

  it('rejects unknown versions', () => {
    expect(() => expandDump({ ...buildDump(input), version: 99 as 1 })).toThrow(/unsupported/)
  })
})
