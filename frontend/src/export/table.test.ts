import { describe, expect, it } from 'vitest'
import type { Finding } from '../kb/kb'
import type { HealthEntry, Person } from '../types'
import {
  CSV_BOM,
  csvCell,
  findingsTable,
  healthTable,
  personColumns,
  render,
  tableToObjects,
  toCsv,
  toJsonl,
} from './table'

const person = (id: string, label: string, displayName = label): Person => ({
  id,
  label,
  displayName,
  sex: 'unknown',
  birthYear: null,
  notes: '',
  createdAt: 't',
})

describe('csv', () => {
  it('quotes only when needed and doubles quotes', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(' padded')).toBe('" padded"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(3)).toBe('3')
  })
  it('starts with a BOM and ends with a newline', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe(`${CSV_BOM}a,b\n1,x\n`)
  })
})

describe('jsonl', () => {
  it('writes one object per line', () => {
    expect(toJsonl([{ a: 1 }, { b: 'x' }])).toBe('{"a":1}\n{"b":"x"}\n')
    expect(toJsonl([])).toBe('')
  })
  it('renders the same table in both formats', () => {
    const t = { header: ['a', 'b'], rows: [[1, null]] as (string | number | null)[][] }
    expect(tableToObjects(t)).toEqual([{ a: 1, b: null }])
    expect(render(t, 'jsonl')).toBe('{"a":1,"b":null}\n')
    expect(render(t, 'csv')).toBe(`${CSV_BOM}a,b\n1,\n`)
  })
})

describe('tables', () => {
  it('makes person column names unique', () => {
    const cols = personColumns([person('1', 'mama'), person('2', 'mama'), person('3', '', 'Papa')])
    expect(cols.map((c) => c.name)).toEqual(['mama', 'mama-2', 'Papa'])
  })

  it('flattens findings with the kb fields', () => {
    const f: Finding = {
      entry: {
        rsid: 'rs1',
        gene: 'G',
        name: 'n',
        risk_allele: 'A',
        orientation: 'plus',
        evidence: 'B',
        summary: 's',
        genotypes: { AA: { label: 'two copies', magnitude: 3 } },
        sources: ['x', 'y'],
        drugs: ['d1'],
        conditions: ['c1', 'c2'],
        topic: 't',
        generated_by: '',
      },
      genotype: 'AA',
      call: { rsid: 'rs1', chromosome: '1', position: 5, a1: 'A', a2: 'A' },
      match: { label: 'two copies', magnitude: 3 },
      riskCopies: 2,
    }
    const t = findingsTable([{ person: person('1', 'me', 'Me'), findings: [f] }])
    expect(t.rows[0]).toEqual([
      'Me',
      'rs1',
      'G',
      'n',
      'AA',
      'A',
      2,
      3,
      'two copies',
      'B',
      't',
      'c1; c2',
      'd1',
      's',
      'x y',
    ])
  })

  it('flattens the health log', () => {
    const e: HealthEntry = {
      id: 'h',
      personId: '1',
      date: '2026-01-02',
      time: '07:30',
      kind: 'symptom',
      title: 'Headache',
      body: 'mild',
      source: '',
      bodyPart: 'head',
      severity: 4,
      tags: ['migraine', 'stress'],
      value: null,
      value2: null,
      unit: '',
      createdAt: 'c',
    }
    const t = healthTable([{ person: person('1', 'me', 'Me'), entries: [e] }], { [e.id]: 2 })
    expect(t.rows[0]).toEqual([
      'Me',
      '2026-01-02',
      '07:30',
      'symptom',
      'Headache',
      'head',
      4,
      null,
      null,
      '',
      'migraine; stress',
      '',
      'mild',
      2, // attachments: the count, never the file names
      'c',
    ])
  })
})
