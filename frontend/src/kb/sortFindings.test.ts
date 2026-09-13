import { describe, expect, it } from 'vitest'
import type { Finding, KbEntry } from './kb'
import { sortFindings } from './sortFindings'

const entry = (o: Partial<KbEntry>): KbEntry => ({
  rsid: 'rs0',
  gene: 'G',
  name: '',
  risk_allele: 'A',
  orientation: 'plus',
  evidence: 'B',
  summary: '',
  genotypes: {},
  sources: [],
  topic: 't',
  generated_by: '',
  ...o,
})
const finding = (o: Partial<KbEntry>, magnitude: number | null, riskCopies = 0): Finding => ({
  entry: entry(o),
  genotype: 'AA',
  call: { rsid: o.rsid ?? 'rs0', chromosome: '1', position: 1, a1: 'A', a2: 'A' },
  match: magnitude === null ? null : { label: '', magnitude },
  riskCopies,
})

const rows = [
  finding({ rsid: 'rs1', gene: 'MTHFR', evidence: 'C', topic: 'b' }, 2, 1),
  finding({ rsid: 'rs2', gene: 'APOE', evidence: 'A', topic: 'a' }, 3, 2),
  finding({ rsid: 'rs3', gene: 'CYP2C19', evidence: 'B', topic: 'c' }, null, 0),
  finding({ rsid: 'rs4', gene: 'APOE', evidence: 'A', topic: 'a' }, 1, 2),
]
const genes = (f: Finding[]) => f.map((x) => x.entry.rsid)

describe('sortFindings', () => {
  it('sorts by gene both ways, rsid breaking ties', () => {
    expect(genes(sortFindings(rows, 'gene', 'asc'))).toEqual(['rs2', 'rs4', 'rs3', 'rs1'])
    expect(genes(sortFindings(rows, 'gene', 'desc'))).toEqual(['rs1', 'rs3', 'rs4', 'rs2'])
  })
  it('sorts by impact with undescribed genotypes last', () => {
    expect(genes(sortFindings(rows, 'magnitude', 'desc'))).toEqual(['rs2', 'rs1', 'rs4', 'rs3'])
    expect(genes(sortFindings(rows, 'magnitude', 'asc'))).toEqual(['rs3', 'rs4', 'rs1', 'rs2'])
  })
  it('sorts by evidence A→C, ties by impact then gene', () => {
    expect(genes(sortFindings(rows, 'evidence', 'asc'))).toEqual(['rs2', 'rs4', 'rs3', 'rs1'])
  })
  it('sorts by risk copies and topic', () => {
    expect(genes(sortFindings(rows, 'riskCopies', 'desc'))).toEqual(['rs2', 'rs4', 'rs1', 'rs3'])
    expect(genes(sortFindings(rows, 'topic', 'asc'))).toEqual(['rs2', 'rs4', 'rs1', 'rs3'])
  })
  it('does not mutate the input', () => {
    const copy = [...rows]
    sortFindings(rows, 'gene', 'asc')
    expect(rows).toEqual(copy)
  })
})
