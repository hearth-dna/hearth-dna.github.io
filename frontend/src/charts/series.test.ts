import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Kb } from '../kb/kb'
import type { HealthEntry, Person } from '../types'
import { availableMetrics, buildPanels, colourSlot, niceTicks, pointTime } from './series'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb

let n = 0
const e = (o: Partial<HealthEntry>): HealthEntry => ({
  id: `e${++n}`,
  personId: 'mum',
  date: '2026-01-01',
  time: '',
  kind: 'lab',
  title: '',
  body: '',
  source: '',
  bodyPart: '',
  side: '',
  severity: null,
  tags: [],
  value: null,
  value2: null,
  unit: '',
  analyte: '',
  refLow: null,
  refHigh: null,
  flag: '',
  valueText: '',
  createdAt: 't',
  ...o,
})

const log = [
  e({
    date: '2026-01-10',
    title: 'Glucose',
    analyte: 'glucose',
    value: 5.4,
    unit: 'mmol/L',
    refLow: 3.9,
    refHigh: 6.1,
  }),
  e({
    date: '2026-03-10',
    title: 'Glucose',
    analyte: 'glucose',
    value: 108,
    unit: 'mg/dL',
    refLow: 70,
    refHigh: 110,
  }),
  e({ date: '2026-02-01', title: 'Глюкоза', value: 6.3, unit: 'mmol/L', personId: 'dad' }), // before the reader: no analyte
  e({
    date: '2026-02-02',
    kind: 'measurement',
    title: 'Blood pressure',
    value: 132,
    value2: 84,
    unit: 'mmHg',
  }),
  e({ date: '2026-02-03', kind: 'measurement', title: 'Weight', value: 71.5, unit: 'kg' }),
  e({ date: '2026-02-04', kind: 'measurement', title: 'Weight', value: 71.1, unit: 'kg', personId: 'dad' }),
  e({ date: '2026-02-05', kind: 'measurement', title: 'Grip strength', value: 30, unit: 'kg' }),
  e({ date: '2026-02-06', title: 'Lp(a)', analyte: 'lpa', value: 30, unit: 'mg/dL' }),
  e({ date: '2026-02-07', kind: 'symptom', title: 'Headache', severity: 5 }),
]

describe('availableMetrics', () => {
  it('groups readings into lab tests, presets and custom measurements, most recorded first', () => {
    const ms = availableMetrics(kb, log)
    expect(ms.map((m) => m.key)).toEqual([
      'lab:glucose',
      'm:weight',
      'lab:lpa|mg/dL',
      'm:blood-pressure:0',
      'm:blood-pressure:1',
      't:grip strength|kg',
    ])
    expect(ms[0]).toMatchObject({ unit: 'mmol/L', group: 'lab', count: 3, personIds: ['mum', 'dad'] })
    expect(ms[1]).toMatchObject({
      source: { kind: 'preset', preset: 'weight' },
      unit: 'kg',
      personIds: ['mum', 'dad'],
    })
  })
})

describe('buildPanels', () => {
  const all = { people: ['mum', 'dad'], from: null, to: null }

  it('puts mg/dL and mmol/L glucose on one line, in mmol/L, oldest first', () => {
    const [p] = buildPanels(kb, log, { ...all, metrics: ['lab:glucose'] })
    expect(p.unit).toBe('mmol/L')
    expect(p.series.map((s) => s.personId)).toEqual(['mum', 'dad'])
    const mum = p.series[0].points
    expect(mum.map((x) => x.entry.date)).toEqual(['2026-01-10', '2026-03-10'])
    expect(mum[1].value).toBeCloseTo(5.99, 2)
  })

  it('splits blood pressure into systolic and diastolic', () => {
    const ps = buildPanels(kb, log, { ...all, metrics: ['m:blood-pressure:0', 'm:blood-pressure:1'] })
    expect(ps.map((p) => [p.source, p.series[0].points[0].value])).toEqual([
      [{ kind: 'preset', preset: 'blood-pressure', part: 0 }, 132],
      [{ kind: 'preset', preset: 'blood-pressure', part: 1 }, 84],
    ])
  })

  it('draws a reference band only when every reading printed the same range', () => {
    const one = buildPanels(kb, log.slice(0, 1), { ...all, metrics: ['lab:glucose'] })[0]
    expect(one.band).toEqual({ low: 3.9, high: 6.1 })
    // The mg/dL report's range converts to 3.9–6.1 as well, but the pre-reader entry printed none.
    expect(buildPanels(kb, log, { ...all, metrics: ['lab:glucose'] })[0].band).toBeNull()
    // 70–110 mg/dL is 3.89–6.11 mmol/L: the same range at glucose's one decimal.
    const two = buildPanels(kb, log.slice(0, 2), { ...all, metrics: ['lab:glucose'] })[0]
    expect(two.band).toEqual({ low: 3.9, high: 6.1 })
    const other = [log[0], { ...log[1], refLow: 60, refHigh: 99 }]
    expect(buildPanels(kb, other, { ...all, metrics: ['lab:glucose'] })[0].band).toBeNull()
  })

  it('keeps the chosen order, the chosen people and the time range', () => {
    const ps = buildPanels(kb, log, {
      metrics: ['m:weight', 'lab:glucose'],
      people: ['dad'],
      from: null,
      to: null,
    })
    expect(ps.map((p) => p.key)).toEqual(['m:weight', 'lab:glucose'])
    expect(ps.every((p) => p.series.every((s) => s.personId === 'dad'))).toBe(true)
    const feb = buildPanels(kb, log, {
      ...all,
      metrics: ['lab:glucose'],
      from: pointTime({ date: '2026-02-01', time: '00:00' }),
      to: pointTime({ date: '2026-02-28', time: '23:59' }),
    })
    expect(feb[0].series.map((s) => s.personId)).toEqual(['dad'])
    expect(buildPanels(kb, log, { ...all, metrics: ['m:nothing'] })).toEqual([])
  })
})

describe('colours and ticks', () => {
  const persons = ['a', 'b', 'c'].map((id) => ({ id }) as Person)
  it('gives a person the same colour whoever else is shown', () => {
    expect(colourSlot(persons, 'c')).toBe(3)
    expect(colourSlot(persons.slice(0), 'c')).toBe(colourSlot(persons, 'c'))
  })
  it('picks round ticks', () => {
    expect(niceTicks(3.8, 6.2)).toEqual([4, 4.5, 5, 5.5, 6])
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(5, 5)).toEqual([5])
  })
})
