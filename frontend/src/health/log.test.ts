import { describe, expect, it } from 'vitest'
import type { HealthEntry } from '../types'
import {
  describeEntry,
  facets,
  filterHealthLog,
  formatTags,
  formatValue,
  isFiltering,
  NO_FILTER,
  normTime,
  parseTags,
  sortHealthLog,
  when,
  where,
} from './log'
import { findPreset, MEASUREMENT_PRESETS, measurementOrder, PRESET_GROUPS } from './presets'

const entry = (o: Partial<HealthEntry>): HealthEntry => ({
  id: 'x',
  personId: 'p',
  date: '2026-09-14',
  time: '',
  kind: 'symptom',
  title: 'Pain',
  body: '',
  source: '',
  bodyPart: '',
  side: '',
  analyte: '',
  refLow: null,
  refHigh: null,
  flag: '' as const,
  valueText: '',
  severity: null,
  tags: [],
  value: null,
  value2: null,
  unit: '',
  createdAt: '2026-09-14T00:00:00Z',
  ...o,
})

describe('tags', () => {
  it('parses loosely typed lists and round-trips', () => {
    expect(parseTags('Arthritis, flare ,,Flare, ')).toEqual(['arthritis', 'flare'])
    expect(parseTags('')).toEqual([])
    expect(formatTags(['a', 'b'])).toBe('a, b')
    expect(parseTags(formatTags(['a', 'b']))).toEqual(['a', 'b'])
  })
})

describe('describeEntry', () => {
  it('appends body part, severity and tags only when present', () => {
    expect(describeEntry(entry({ kind: 'lab', title: 'Lipid panel' }))).toBe(
      '2026-09-14 · Lab result · Lipid panel',
    )
    expect(
      describeEntry(
        entry({ title: 'Pain in both hands', bodyPart: 'hands', severity: 6, tags: ['arthritis'] }),
      ),
    ).toBe('2026-09-14 · Symptom · Pain in both hands (hands; severity 6/10; arthritis)')
  })
  it('names the side of a paired body part', () => {
    expect(where({ bodyPart: 'knees', side: '' })).toBe('knees')
    expect(where({ bodyPart: 'knees', side: 'left' })).toBe('knees, left')
    expect(where({ bodyPart: 'knees', side: 'both' })).toBe('knees, both sides')
    expect(where({ bodyPart: '', side: 'right' })).toBe('')
    expect(describeEntry(entry({ title: 'Knee pain', bodyPart: 'knees', side: 'right', severity: 4 }))).toBe(
      '2026-09-14 · Symptom · Knee pain (knees, right; severity 4/10)',
    )
  })
  it('puts the measured value after the title', () => {
    expect(
      describeEntry(
        entry({
          kind: 'measurement',
          title: 'Blood pressure',
          value: 120,
          value2: 80,
          unit: 'mmHg',
          bodyPart: 'heart',
        }),
      ),
    ).toBe('2026-09-14 · Measurement · Blood pressure 120/80 mmHg (heart)')
    expect(describeEntry(entry({ kind: 'measurement', title: 'Temperature', value: 37.8, unit: '°C' }))).toBe(
      '2026-09-14 · Measurement · Temperature 37.8 °C',
    )
  })
})

describe('formatValue', () => {
  it('handles single values, pairs and missing units', () => {
    expect(formatValue({ value: null, value2: null, unit: '°C' })).toBe('')
    expect(formatValue({ value: 72, value2: null, unit: '' })).toBe('72')
    expect(formatValue({ value: 120, value2: 80, unit: 'mmHg' })).toBe('120/80 mmHg')
  })
})

describe('measurementOrder', () => {
  it('puts what the person records most recently first, then the rest', () => {
    const e = (kind: string, title: string) => ({ kind, title })
    const order = measurementOrder([
      e('measurement', 'Weight'),
      e('symptom', 'Headache'),
      e('measurement', ' height '),
      e('measurement', 'Weight'),
    ])
    expect(order.slice(0, 2).map((p) => p.id)).toEqual(['weight', 'height'])
    expect(order.length).toBe(MEASUREMENT_PRESETS.length)
    expect(new Set(order.map((p) => p.id)).size).toBe(order.length)
    expect(measurementOrder([]).map((p) => p.id)).toEqual(MEASUREMENT_PRESETS.map((p) => p.id))
  })
})

describe('presets', () => {
  it('have unique ids, and measurements always carry a unit', () => {
    const ids = PRESET_GROUPS.flatMap((g) => g.presets.map((p) => p.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PRESET_GROUPS.flatMap((g) => g.presets)) {
      if (p.kind === 'measurement') expect(p.unit).toBeTruthy()
      else expect(p.unit).toBeUndefined()
    }
    expect(findPreset('blood-pressure')?.pair).toEqual(['systolic', 'diastolic'])
    expect(findPreset('nosebleed')).toMatchObject({ kind: 'symptom', bodyPart: 'nose' })
    expect(findPreset('nope')).toBeUndefined()
  })
})

describe('filterHealthLog', () => {
  const log = [
    entry({ id: '1', title: 'Pain in hands', bodyPart: 'hands', severity: 6, tags: ['arthritis'] }),
    entry({ id: '2', title: 'Headache', bodyPart: 'head', severity: 3, tags: ['migraine'] }),
    entry({ id: '3', kind: 'lab', title: 'CRP', body: 'CRP 12 mg/L', tags: ['arthritis'] }),
    entry({ id: '4', kind: 'measurement', title: 'Temperature', value: 38.2, unit: '°C' }),
  ]
  const ids = (f: Partial<typeof NO_FILTER>) => filterHealthLog(log, { ...NO_FILTER, ...f }).map((e) => e.id)

  it('passes everything with no filter', () => expect(ids({})).toEqual(['1', '2', '3', '4']))
  it('filters by kind, body part and tag', () => {
    expect(ids({ kind: 'symptom' })).toEqual(['1', '2'])
    expect(ids({ bodyPart: 'head' })).toEqual(['2'])
    expect(ids({ tag: 'arthritis' })).toEqual(['1', '3'])
    expect(ids({ tag: 'arthritis', kind: 'lab' })).toEqual(['3'])
  })
  it('searches title, body, body part and tags case-insensitively', () => {
    expect(ids({ text: 'HAND' })).toEqual(['1'])
    expect(ids({ text: 'mg/l' })).toEqual(['3'])
    expect(ids({ text: 'migr' })).toEqual(['2'])
    expect(ids({ text: '°c' })).toEqual(['4'])
    expect(ids({ kind: 'measurement' })).toEqual(['4'])
  })
  it('filters by person, date range and minimum severity', () => {
    const more = [
      entry({ id: 'a', personId: 'p1', date: '2026-01-05', severity: 2 }),
      entry({ id: 'b', personId: 'p2', date: '2026-02-10', severity: 7 }),
      entry({ id: 'c', personId: 'p1', date: '2026-03-15' }),
    ]
    const f = (o: Partial<typeof NO_FILTER>) => filterHealthLog(more, { ...NO_FILTER, ...o }).map((e) => e.id)
    expect(f({ person: 'p1' })).toEqual(['a', 'c'])
    expect(f({ from: '2026-02-10' })).toEqual(['b', 'c'])
    expect(f({ to: '2026-02-10' })).toEqual(['a', 'b'])
    expect(f({ minSeverity: 3 })).toEqual(['b'])
    expect(isFiltering(NO_FILTER)).toBe(false)
    expect(isFiltering({ ...NO_FILTER, minSeverity: 1 })).toBe(true)
  })
  it('lists distinct facets sorted', () => {
    expect(facets(log)).toEqual({ bodyParts: ['hands', 'head'], tags: ['arthritis', 'migraine'] })
  })
})

describe('sortHealthLog', () => {
  const log = [
    entry({ id: '1', personId: 'b', date: '2026-01-01', kind: 'lab', title: 'CRP', createdAt: '1' }),
    entry({ id: '2', personId: 'a', date: '2026-03-01', title: 'ache', severity: 4, createdAt: '2' }),
    entry({
      id: '3',
      personId: 'a',
      date: '2026-02-01',
      kind: 'measurement',
      title: 'Weight',
      value: 70,
      createdAt: '3',
    }),
    entry({ id: '4', personId: 'b', date: '2026-03-01', title: 'Back pain', severity: 8, createdAt: '4' }),
  ]
  const ids = (k: Parameters<typeof sortHealthLog>[1], d: 'asc' | 'desc', name?: (id: string) => string) =>
    sortHealthLog(log, k, d, name).map((e) => e.id)

  it('sorts by date both ways, ties newest-created first', () => {
    expect(ids('date', 'desc')).toEqual(['4', '2', '3', '1'])
    expect(ids('date', 'asc')).toEqual(['1', '3', '4', '2'])
  })
  it('keeps empty values last in either direction', () => {
    expect(ids('severity', 'desc')).toEqual(['4', '2', '3', '1'])
    expect(ids('severity', 'asc')).toEqual(['2', '4', '3', '1'])
    expect(ids('value', 'asc')[0]).toBe('3')
  })
  it('sorts titles case-insensitively and people by display name', () => {
    expect(ids('title', 'asc')).toEqual(['2', '4', '1', '3'])
    expect(ids('person', 'asc', (id) => (id === 'a' ? 'Zoe' : 'Adam'))).toEqual(['4', '1', '2', '3'])
  })
  it('does not mutate its input', () => {
    sortHealthLog(log, 'title', 'asc')
    expect(log.map((e) => e.id)).toEqual(['1', '2', '3', '4'])
  })
})

describe('time of day', () => {
  it('normalises HH:MM and rejects anything else', () => {
    expect(normTime('8:05')).toBe('08:05')
    expect(normTime('23:59')).toBe('23:59')
    expect(normTime('07:30:12')).toBe('07:30')
    expect(normTime('24:00')).toBe('')
    expect(normTime('12:60')).toBe('')
    expect(normTime('noon')).toBe('')
    expect(normTime('')).toBe('')
  })
  it('shows the time after the date only when there is one', () => {
    expect(when({ date: '2026-09-14', time: '06:45' })).toBe('2026-09-14 06:45')
    expect(when({ date: '2026-09-14', time: '' })).toBe('2026-09-14')
    expect(describeEntry(entry({ title: 'Temp', time: '21:10' }))).toMatch(/^2026-09-14 21:10 · /)
    expect(describeEntry(entry({ title: 'Temp' }))).toMatch(/^2026-09-14 · /)
  })
  it('orders same-day entries by time, untimed ones first when ascending', () => {
    const day = [
      entry({ id: 'evening', time: '21:00', createdAt: '1' }),
      entry({ id: 'untimed', time: '', createdAt: '2' }),
      entry({ id: 'morning', time: '07:00', createdAt: '3' }),
    ]
    expect(sortHealthLog(day, 'date', 'desc').map((e) => e.id)).toEqual(['evening', 'morning', 'untimed'])
    expect(sortHealthLog(day, 'date', 'asc').map((e) => e.id)).toEqual(['untimed', 'morning', 'evening'])
  })
})
