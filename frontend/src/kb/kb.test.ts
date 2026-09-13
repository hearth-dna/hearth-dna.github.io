import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computeFindings, type Kb, normGenotype, searchKb } from './kb'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb

describe('kb', () => {
  it('has forward-strand entries with sorted genotype keys', () => {
    expect(kb.entries.length).toBeGreaterThan(20)
    for (const e of kb.entries) {
      expect(e.orientation).toBe('forward')
      for (const k of Object.keys(e.genotypes)) expect(k).toBe(normGenotype(k[0], k[1]))
    }
  })
  it('computes findings and risk copies regardless of allele order', () => {
    const f = computeFindings(kb, [
      { rsid: 'rs7903146', chromosome: '10', position: 1, a1: 'T', a2: 'C' },
      { rsid: 'rs12248560', chromosome: '10', position: 2, a1: 'T', a2: 'T' },
      { rsid: 'rs999999', chromosome: '1', position: 3, a1: 'A', a2: 'A' },
    ])
    expect(f).toHaveLength(2)
    const tcf = f.find((x) => x.entry.rsid === 'rs7903146')!
    expect(tcf.genotype).toBe('CT')
    expect(tcf.riskCopies).toBe(1)
    expect(tcf.match?.magnitude).toBe(2)
    expect(f[0].entry.rsid).toBe('rs12248560') // higher magnitude first
  })
  it('searches drugs and conditions', () => {
    expect(searchKb(kb, 'clopidogrel').map((e) => e.rsid)).toContain('rs4244285')
    expect(searchKb(kb, 'diabetes').map((e) => e.gene)).toContain('TCF7L2')
    expect(searchKb(kb, '')).toEqual([])
  })
})
