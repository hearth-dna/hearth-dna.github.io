import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Kb } from '../kb/kb'
import type { HealthEntry, Person } from '../types'
import { lmsValue, percentileOf, referenceFor } from './reference'
import { bmiReadings } from './series'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb
const DAY = 86_400_000
const at = (d: string) => new Date(`${d}T12:00`).getTime()

const person = (o: Partial<Person>): Person => ({
  id: 'kid',
  label: 'kid',
  displayName: 'Kid',
  sex: 'male',
  birthYear: 2020,
  birthDate: '2020-01-01',
  notes: '',
  createdAt: '',
  ...o,
})

/** L, M, S of a WHO row by indicator, sex and month. */
const row = (ind: keyof Kb['growth']['indicators'], sex: 'boys' | 'girls', month: number) => {
  const [, l, m, s] = kb.growth.indicators[ind][sex][month]
  return [l, m, s] as [number, number, number]
}

describe('WHO growth curves', () => {
  it('give the published percentiles', () => {
    // WHO weight-for-age, boys, 12 months: P3 7.8, P50 9.6, P97 11.8 kg.
    const w = row('wfa', 'boys', 12)
    expect(lmsValue(w, -1.880794)).toBeCloseTo(7.8, 1)
    expect(lmsValue(w, 0)).toBeCloseTo(9.6, 1)
    expect(lmsValue(w, 1.880794)).toBeCloseTo(11.8, 1)
    // WHO height-for-age, girls, 10 years: P50 138.6 cm.
    expect(lmsValue(row('lhfa', 'girls', 120), 0)).toBeCloseTo(138.6, 1)
  })

  it("place a child's reading on its percentile", () => {
    const kid = person({})
    const t = new Date('2021-01-01T00:00').getTime()
    expect(percentileOf(kb, 'm:weight', kid, t, row('wfa', 'boys', 12)[1])).toBeCloseTo(50, 0)
    expect(percentileOf(kb, 'm:weight', kid, t, 12)).toBeGreaterThan(97)
    expect(percentileOf(kb, 'm:heart-rate', kid, t, 100)).toBeNull()
    expect(percentileOf(kb, 'm:weight', person({ birthDate: '' }), t, 9)).toBeNull()
  })
})

describe('referenceFor', () => {
  const domain: [number, number] = [at('2021-01-01'), at('2023-01-01')]

  it('draws P3–P97 and P15–P85 bands and the median for a child', () => {
    const r = referenceFor(kb, 'm:height', person({}), domain)
    expect(r.missing).toBeNull()
    expect(r.reference?.kind).toBe('growth')
    expect(r.reference?.bands.map((b) => b.labels)).toEqual([
      ['P3', 'P97'],
      ['P15', 'P85'],
    ])
    expect(r.reference?.lines.map((l) => l.label)).toEqual(['P50'])
  })

  it("says what is missing before a child's curves can be drawn", () => {
    expect(referenceFor(kb, 'm:weight', person({ birthDate: '' }), domain).missing).toBe('birthDate')
    expect(referenceFor(kb, 'm:weight', person({ sex: 'unknown' }), domain).missing).toBe('sex')
    // Nothing known about the age: weight has only curves, so ask; BMI falls back to adults.
    const nobody = person({ birthDate: '', birthYear: null })
    expect(referenceFor(kb, 'm:weight', nobody, domain).missing).toBe('birthDate')
    expect(referenceFor(kb, 'd:bmi', nobody, domain).reference?.lines.map((l) => l.label)).toEqual([
      'underweight',
      'overweight',
      'obese',
    ])
  })

  it('gives adults their ranges and no growth curve', () => {
    const adult = person({ birthDate: '1980-05-01', birthYear: 1980 })
    expect(referenceFor(kb, 'm:weight', adult, domain).reference).toBeNull()
    const bp = referenceFor(kb, 'm:blood-pressure:0', adult, domain).reference
    expect(bp?.bands[0].lower[0][1]).toBe(90)
    expect(bp?.bands[0].upper[0][1]).toBe(120)
  })

  it('cuts age-banded ranges where a birthday moves the band', () => {
    // Pulse: 60–140 until 10 years, 60–100 after; the domain spans the 10th birthday.
    const r = referenceFor(kb, 'm:heart-rate', person({}), [at('2029-06-01'), at('2030-06-01')]).reference
    expect(r?.bands.map((b) => [b.lower[0][1], b.upper[0][1]])).toEqual([
      [60, 140],
      [60, 100],
    ])
    expect(Math.abs((r?.bands[0].upper[1][0] ?? 0) - new Date('2030-01-01T00:00').getTime())).toBeLessThan(
      DAY,
    )
  })
})

let n = 0
const m = (personId: string, date: string, title: string, value: number, unit: string): HealthEntry => ({
  id: `m${++n}`,
  personId,
  date,
  time: '',
  kind: 'measurement',
  title,
  body: '',
  source: '',
  bodyPart: '',
  side: '',
  severity: null,
  tags: [],
  value,
  value2: null,
  unit,
  analyte: '',
  refLow: null,
  refHigh: null,
  flag: '',
  valueText: '',
  conditions: [],
  details: {},
  createdAt: '',
})

describe('BMI', () => {
  it('interpolates the height between the measurements around a weighing', () => {
    const es = [
      m('kid', '2024-01-01', 'Height', 100, 'cm'),
      m('kid', '2024-03-01', 'Weight', 20, 'kg'),
      m('kid', '2024-05-01', 'Height', 110, 'cm'),
    ]
    const r = bmiReadings(es, [person({})])
    // 2024-03-01 is 60 of 121 days in: 104.96 cm.
    expect(r.map((x) => x.value)).toEqual([18.2])
    expect(r[0].key).toBe('d:bmi')
  })

  it("does not trust a child's height from long before, but does an adult's", () => {
    const es = [m('kid', '2023-01-01', 'Height', 100, 'cm'), m('kid', '2024-01-01', 'Weight', 20, 'kg')]
    expect(bmiReadings(es, [person({})])).toEqual([])
    const adult = [m('dad', '2020-01-01', 'Height', 180, 'cm'), m('dad', '2024-01-01', 'Weight', 81, 'kg')]
    expect(bmiReadings(adult, [person({ id: 'dad', birthDate: '1980-01-01' })]).map((x) => x.value)).toEqual([
      25,
    ])
  })
})
