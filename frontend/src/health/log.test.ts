import { describe, expect, it } from 'vitest'
import { BODY_PARTS, type HealthEntry } from '../types'
import {
  daysBefore,
  describeEntry,
  detailsCell,
  facets,
  filterHealthLog,
  formatDetails,
  formatDetailsJson,
  formatTags,
  formatValue,
  groupByDate,
  isFiltering,
  NO_FILTER,
  normTime,
  panelFilterCount,
  parseDetails,
  parseTags,
  sortHealthLog,
  when,
  where,
} from './log'
import { today } from './now'
import {
  entryTitle,
  findPreset,
  MEASUREMENT_PRESETS,
  PRESET_GROUPS,
  presetOf,
  presetOrder,
  SYMPTOM_PRESETS,
  symptomPreset,
} from './presets'

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
  conditions: [],
  details: {},
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

describe('presetOrder', () => {
  it('puts what the person records most recently first, then the rest', () => {
    const e = (kind: string, title: string) => ({ kind, title })
    const order = presetOrder('measurement', [
      e('measurement', 'Weight'),
      e('symptom', 'Headache'),
      e('measurement', ' height '),
      e('measurement', 'Weight'),
    ])
    expect(order.slice(0, 2).map((p) => p.id)).toEqual(['weight', 'height'])
    expect(order.length).toBe(MEASUREMENT_PRESETS.length)
    expect(new Set(order.map((p) => p.id)).size).toBe(order.length)
    expect(presetOrder('measurement', []).map((p) => p.id)).toEqual(MEASUREMENT_PRESETS.map((p) => p.id))
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
  it('give every symptom synonyms, and no name points to two presets of one kind', () => {
    for (const p of SYMPTOM_PRESETS) expect(p.synonyms?.length, p.id).toBeGreaterThan(0)
    const all = PRESET_GROUPS.flatMap((g) => g.presets)
    for (const p of all)
      for (const name of [p.title, ...(p.synonyms ?? [])])
        expect(presetOf({ kind: p.kind, title: name })?.id, `${p.id}: ${name}`).toBe(p.id)
  })
  it('find the preset an entry names, in any listed language, and show it in the UI language', () => {
    expect(presetOf({ kind: 'symptom', title: 'Headache' })?.id).toBe('headache')
    expect(presetOf({ kind: 'symptom', title: ' Головная  боль ' })?.id).toBe('headache')
    expect(presetOf({ kind: 'symptom', title: 'Kopfschmerzen' })?.id).toBe('headache')
    expect(presetOf({ kind: 'symptom', title: 'Ночная потливость' })?.id).toBe('night-sweats')
    expect(presetOf({ kind: 'measurement', title: 'вес' })?.id).toBe('weight')
    expect(presetOf({ kind: 'measurement', title: 'Headache' })).toBeUndefined()
    expect(presetOf({ kind: 'symptom', title: 'Pain in hands' })).toBeUndefined()
    const t = (key: string) => (key === 'preset.headache' ? 'Головная боль' : key)
    expect(entryTitle({ kind: 'symptom', title: 'Headache' }, t)).toBe('Головная боль')
    expect(entryTitle({ kind: 'symptom', title: 'Pain in hands' }, t)).toBe('Pain in hands')
  })
})

describe('filterHealthLog', () => {
  const log = [
    entry({ id: '1', title: 'Pain in hands', bodyPart: 'hands', severity: 6, tags: ['arthritis'] }),
    entry({ id: '2', title: 'Headache', bodyPart: 'head', severity: 3, tags: ['migraine'] }),
    entry({
      id: '3',
      kind: 'lab',
      title: 'CRP',
      body: 'CRP 12 mg/L',
      tags: ['arthritis'],
      conditions: ['arthritis'],
    }),
    entry({ id: '4', kind: 'measurement', title: 'Temperature', value: 38.2, unit: '°C' }),
  ]
  const ids = (f: Partial<typeof NO_FILTER>) => filterHealthLog(log, { ...NO_FILTER, ...f }).map((e) => e.id)

  it('passes everything with no filter', () => expect(ids({})).toEqual(['1', '2', '3', '4']))
  it('filters by kind, body part and tag', () => {
    expect(ids({ kind: 'symptom' })).toEqual(['1', '2'])
    expect(ids({ bodyPart: 'head' })).toEqual(['2'])
    expect(ids({ tag: 'arthritis' })).toEqual(['1', '3'])
    expect(ids({ tag: 'arthritis', kind: 'lab' })).toEqual(['3'])
    expect(ids({ condition: 'arthritis' })).toEqual(['3'])
  })
  it('searches the title the table shows too', () => {
    const shown = (e: { title: string }) => (e.title === 'Headache' ? 'Головная боль' : e.title)
    expect(filterHealthLog(log, { ...NO_FILTER, text: 'голов' }, shown).map((e) => e.id)).toEqual(['2'])
    expect(filterHealthLog(log, { ...NO_FILTER, text: 'head' }, shown).map((e) => e.id)).toEqual(['2'])
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
    expect(facets(log)).toEqual({
      bodyParts: ['hands', 'head'],
      tags: ['arthritis', 'migraine'],
      conditions: ['arthritis'],
    })
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

describe('symptom details', () => {
  it('reads and writes the details column, dropping anything malformed', () => {
    expect(parseDetails('')).toEqual({})
    expect(parseDetails('not json')).toEqual({})
    expect(parseDetails('[1]')).toEqual({})
    expect(parseDetails('{"bristol":6,"blood":true,"colour":"yellow","x":null,"y":""}')).toEqual({
      bristol: 6,
      blood: true,
      colour: 'yellow',
    })
    expect(formatDetailsJson({})).toBe('')
    expect(parseDetails(formatDetailsJson({ bristol: 4 }))).toEqual({ bristol: 4 })
    expect(detailsCell({ bristol: 6, colour: 'yellow', blood: true })).toBe('bristol=6; colour=yellow; blood')
  })

  it('describes details in the preset order for Ask, and searches them', () => {
    const stool = entry({
      id: 's',
      kind: 'symptom',
      title: 'Stool',
      details: { blood: true, bristol: 6, colour: 'yellow' },
    })
    expect(formatDetails(stool)).toBe('Bristol type 6, colour yellow, blood')
    expect(describeEntry(stool)).toContain('Stool (Bristol type 6, colour yellow, blood')
    expect(filterHealthLog([stool], { ...NO_FILTER, text: 'blood' }).map((e) => e.id)).toEqual(['s'])
    const cough = entry({ kind: 'symptom', title: 'Eye irritation', details: { discharge: 'sticky' } })
    expect(formatDetails(cough)).toBe('discharge sticky')
  })

  it('gives every new symptom a known body part and consistent detail fields', () => {
    for (const p of SYMPTOM_PRESETS) {
      if (p.bodyPart) expect(BODY_PARTS, p.id).toContain(p.bodyPart)
      for (const f of p.details ?? []) {
        if (f.kind === 'choice') expect(new Set(f.options).size, `${p.id}.${f.id}`).toBe(f.options.length)
        if (f.kind === 'scale') expect(f.max, `${p.id}.${f.id}`).toBeGreaterThan(f.min)
      }
    }
    expect(symptomPreset('Eye irritation')?.id).toBe('eye-irritation')
    expect(presetOrder('symptom', [{ kind: 'symptom', title: 'Cough' }])[0].id).toBe('cough')
  })
})

describe('dates', () => {
  it('formats the local calendar date', () => {
    expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
  it('steps back across months, years and leap days', () => {
    expect(daysBefore('2026-09-14', 0)).toBe('2026-09-14')
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28')
    expect(daysBefore('2024-03-01', 1)).toBe('2024-02-29')
    expect(daysBefore('2026-01-03', 6)).toBe('2025-12-28')
  })
})

describe('card view helpers', () => {
  it('counts panel filters, a date range once, and ignores kind and search text', () => {
    expect(panelFilterCount(NO_FILTER)).toBe(0)
    expect(panelFilterCount({ ...NO_FILTER, kind: 'lab', text: 'x' })).toBe(0)
    expect(panelFilterCount({ ...NO_FILTER, condition: 'asthma' })).toBe(1)
    expect(panelFilterCount({ ...NO_FILTER, from: '2026-01-01', to: '2026-02-01', tag: 'a' })).toBe(2)
    expect(
      panelFilterCount({ ...NO_FILTER, person: 'p', bodyPart: 'hands', minSeverity: 1, to: '2026-01-01' }),
    ).toBe(4)
  })
  it('groups consecutive entries by date, keeping order', () => {
    const g = groupByDate([
      entry({ id: 'a', date: '2026-09-14' }),
      entry({ id: 'b', date: '2026-09-14' }),
      entry({ id: 'c', date: '2026-09-12' }),
    ])
    expect(g.map((x) => [x.date, x.entries.map((e) => e.id)])).toEqual([
      ['2026-09-14', ['a', 'b']],
      ['2026-09-12', ['c']],
    ])
    expect(groupByDate([])).toEqual([])
  })
})
