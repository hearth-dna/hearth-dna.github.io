import { describe, expect, it } from 'vitest'
import type { HealthEntry } from '../types'
import { describeEntry, facets, filterHealthLog, formatTags, NO_FILTER, parseTags } from './log'

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
})

describe('filterHealthLog', () => {
  const log = [
    entry({ id: '1', title: 'Pain in hands', bodyPart: 'hands', severity: 6, tags: ['arthritis'] }),
    entry({ id: '2', title: 'Headache', bodyPart: 'head', severity: 3, tags: ['migraine'] }),
    entry({ id: '3', kind: 'lab', title: 'CRP', body: 'CRP 12 mg/L', tags: ['arthritis'] }),
  ]
  const ids = (f: Partial<typeof NO_FILTER>) => filterHealthLog(log, { ...NO_FILTER, ...f }).map((e) => e.id)

  it('passes everything with no filter', () => expect(ids({})).toEqual(['1', '2', '3']))
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
  })
  it('lists distinct facets sorted', () => {
    expect(facets(log)).toEqual({ bodyParts: ['hands', 'head'], tags: ['arthritis', 'migraine'] })
  })
})
