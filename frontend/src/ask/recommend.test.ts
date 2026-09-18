import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computeFindings, type Kb } from '../kb/kb'
import type { HealthEntry } from '../types'
import { classifyQuestion } from './intent'
import { findingKey, genotypeKey, healthKey, parseKey, recommend } from './recommend'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb
const now = new Date('2026-09-17T12:00:00Z')

const h = (o: Partial<HealthEntry>): HealthEntry => ({
  id: 'x',
  personId: 'a',
  date: '2026-09-10',
  time: '',
  kind: 'symptom',
  title: '',
  body: '',
  source: '',
  bodyPart: '',
  severity: null,
  tags: [],
  value: null,
  value2: null,
  unit: '',
  createdAt: '',
  ...o,
})
// CYP2C19*2 carrier (pharmacogenomic) and TCF7L2 risk allele carrier.
const calls = [
  { rsid: 'rs4244285', chromosome: '10', position: 1, a1: 'A', a2: 'G' },
  { rsid: 'rs7903146', chromosome: '10', position: 2, a1: 'C', a2: 'T' },
]
const findings = computeFindings(kb, calls)
const health = [
  h({ id: 'med1', kind: 'medication', title: 'Aspirin 100 mg', date: '2026-08-01' }),
  h({ id: 'lab1', kind: 'lab', title: 'Lipid panel', date: '2025-01-01' }),
  h({ id: 'sym1', kind: 'symptom', title: 'Stiff hands', bodyPart: 'hands', date: '2026-09-15' }),
  h({ id: 'sym-old', kind: 'symptom', title: 'Cold', date: '2026-01-01' }),
  h({ id: 'meas1', kind: 'measurement', title: 'Blood pressure', date: '2026-09-16' }),
]
const run = (q: string, people = [{ personId: 'a', findings, health }]) =>
  recommend(kb, q, classifyQuestion(q, kb, people.length), people, now)

describe('item keys', () => {
  it('round-trip, including ids with colons', () => {
    expect(parseKey(findingKey('p1', 'rs1'))).toEqual({ kind: 'f', personId: 'p1', id: 'rs1' })
    expect(parseKey(genotypeKey('p1', 'rs2'))).toEqual({ kind: 'g', personId: 'p1', id: 'rs2' })
    expect(parseKey(healthKey('p1', 'a:b'))).toEqual({ kind: 'h', personId: 'p1', id: 'a:b' })
    expect(parseKey('nope')).toBeNull()
  })
})

describe('recommend', () => {
  it('medication: named gene first, pharmacogenomic markers, current medications', () => {
    const s = run('Is clopidogrel safe with my other medication?')
    expect(s.map((x) => [x.key, x.reason.why])).toEqual([
      ['f:a:rs4244285', 'mentioned'],
      ['h:a:med1', 'recent'],
    ])
  })
  it('symptoms: recent symptoms and measurements, older ones only as a fallback', () => {
    const keys = run('my hands feel stiff').map((x) => x.key)
    expect(keys).toContain('h:a:sym1')
    expect(keys).toContain('h:a:meas1')
    expect(keys).not.toContain('h:a:sym-old')
    expect(keys).not.toContain('h:a:lab1')
  })
  it('labs: an old lab result still counts when there is no recent one', () => {
    expect(run('explain my lab results').map((x) => x.key)).toContain('h:a:lab1')
  })
  it('family: variants carried by more than one person', () => {
    const people = [
      { personId: 'a', findings, health: [] },
      { personId: 'b', findings: computeFindings(kb, [calls[1]]), health: [] },
    ]
    const s = run('who carries what', people)
    expect(s.filter((x) => x.reason.why === 'sharedVariant').map((x) => x.key)).toEqual([
      'f:a:rs7903146',
      'f:b:rs7903146',
    ])
  })
  it('does not match health text on short common words', () => {
    expect(run('did the hands get better').map((x) => [x.key, x.reason.why])).toContainEqual([
      'h:a:sym1',
      'matchesQuestion',
    ])
    expect(run('what is the plan').filter((x) => x.reason.why === 'matchesQuestion')).toEqual([])
  })
  it('suggests nothing for a question without signals or matches', () => {
    expect(run('hello')).toEqual([])
  })
})
