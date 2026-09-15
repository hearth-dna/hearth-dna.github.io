import { describe, expect, it } from 'vitest'
import type { HealthEntry } from '../types'
import { describeEntry, facets, filterHealthLog, formatTags, formatValue, NO_FILTER, parseTags } from './log'
import { findPreset, PRESET_GROUPS } from './presets'

const entry = (o: Partial<HealthEntry>): HealthEntry => ({
  id: 'x',
  personId: 'p',
  date: '2026-09-14',
  kind: 'symptom',
  title: 'Pain',
  body: '',
  source: '',
  bodyPart: '',
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
  it('lists distinct facets sorted', () => {
    expect(facets(log)).toEqual({ bodyParts: ['hands', 'head'], tags: ['arthritis', 'migraine'] })
  })
})
