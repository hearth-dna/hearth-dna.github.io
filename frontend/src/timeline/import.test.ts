import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Kb } from '../kb/kb'
import { parseTable } from '../text/table'
import type { HealthEntry } from '../types'
import { guessDateFormat, parseDate, parseTime } from './dates'
import { buildEntries, type Mapping, splitHeader, suggestMapping, suggestMetric } from './import'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb
const table = (name: string) => parseTable(readFileSync(`${__dirname}/fixtures/${name}`, 'utf8'))
/** Russian UI names of a few presets, as the dialog passes them from i18n. */
const RU: Record<string, string[]> = {
  height: ['Рост'],
  weight: ['Вес'],
  'head-circumference': ['Окружность головы'],
}
const names = (id: string) => RU[id] ?? []
const labTitle = (id: string) => kb.analytes.find((a) => a.id === id)?.names.en ?? id
const build = (name: string, mapping: Mapping, existing: HealthEntry[] = []) =>
  buildEntries(kb, table(name), mapping, { personId: 'kid', source: 'csv:x', existing, labTitle })

describe('dates', () => {
  it('reads each format and decides day- or month-first for the whole column', () => {
    expect(parseDate('2026-02-01 07:31:00 +0100', 'ymd')).toEqual({ date: '2026-02-01', time: '07:31' })
    expect(parseDate('01.03.2025', 'dmy')).toEqual({ date: '2025-03-01', time: '' })
    expect(parseDate('01/26/2026', 'mdy')).toEqual({ date: '2026-01-26', time: '' })
    expect(parseDate('3/4/26 8:05 pm', 'dmy')).toEqual({ date: '2026-04-03', time: '20:05' })
    expect(parseDate('45658', 'serial')).toEqual({ date: '2025-01-01', time: '' })
    expect(parseDate('31/02/2026', 'dmy')).toBeNull()
    expect(guessDateFormat(['01/05/2026', '01/26/2026'])).toEqual({ format: 'mdy', ambiguous: false })
    expect(guessDateFormat(['13.03.2025', '01.04.2025'])).toEqual({ format: 'dmy', ambiguous: false })
    expect(guessDateFormat(['01/05/2026', '02/06/2026'])).toEqual({ format: 'dmy', ambiguous: true })
    expect(guessDateFormat(['hello'])).toBeNull()
    expect(parseTime('8:30 pm')).toBe('20:30')
  })
})

describe('suggestions', () => {
  it('splits units out of headers', () => {
    expect(splitHeader('Weight (lb)')).toEqual({ name: 'Weight', unit: 'lb' })
    expect(splitHeader('Рост, см')).toEqual({ name: 'Рост', unit: 'см' })
    expect(splitHeader('Systolic')).toEqual({ name: 'Systolic', unit: '' })
  })
  it('recognises presets, blood pressure halves, lab tests and device names', () => {
    expect(suggestMetric(kb, 'Weight (lb)', names).target).toEqual({ kind: 'preset', preset: 'weight' })
    expect(suggestMetric(kb, 'Diastolic', names).target).toEqual({
      kind: 'preset',
      preset: 'blood-pressure',
      part: 1,
    })
    expect(suggestMetric(kb, 'HKQuantityTypeIdentifierBodyMass', names).target).toEqual({
      kind: 'preset',
      preset: 'weight',
    })
    expect(suggestMetric(kb, 'Ferritin (ng/mL)', names).target).toEqual({ kind: 'lab', analyte: 'ferritin' })
    expect(suggestMetric(kb, 'Grip strength', names).target).toEqual({
      kind: 'custom',
      title: 'Grip strength',
    })
  })
  it('maps a wide file column by column', () => {
    const m = suggestMapping(kb, table('growth.csv'), names)
    expect(m.shape).toBe('wide')
    expect(m.columns).toEqual([
      { role: 'date', format: 'dmy' },
      { role: 'metric', metric: { target: { kind: 'preset', preset: 'height' }, unit: 'см' } },
      { role: 'metric', metric: { target: { kind: 'preset', preset: 'weight' }, unit: 'кг' } },
      { role: 'metric', metric: { target: { kind: 'preset', preset: 'head-circumference' }, unit: 'см' } },
      { role: 'note' },
    ])
  })
  it('maps a long file by its columns and its distinct metric names', () => {
    const m = suggestMapping(kb, table('device-export.csv'), names)
    expect(m.shape).toBe('long')
    expect(m.columns.map((c) => c.role)).toEqual(['name', 'unit', 'value', 'date'])
    expect(m.names).toEqual({
      HKQuantityTypeIdentifierBodyMass: { target: { kind: 'preset', preset: 'weight' }, unit: 'kg' },
      HKQuantityTypeIdentifierHeartRate: {
        target: { kind: 'preset', preset: 'heart-rate' },
        unit: 'count/min',
      },
      HKQuantityTypeIdentifierBodyTemperature: {
        target: { kind: 'preset', preset: 'temperature' },
        unit: 'degF',
      },
      HKQuantityTypeIdentifierFlightsClimbed: {
        target: { kind: 'custom', title: 'HKQuantityTypeIdentifierFlightsClimbed' },
        unit: 'count',
      },
    })
  })
})

describe('buildEntries', () => {
  it('imports a Russian growth table with decimal commas and notes', () => {
    const r = build('growth.csv', suggestMapping(kb, table('growth.csv'), names))
    expect(r.entries).toHaveLength(12)
    expect(r.entries[0]).toEqual({
      personId: 'kid',
      date: '2025-03-01',
      time: '',
      kind: 'measurement',
      title: 'Height',
      body: 'роддом',
      source: 'csv:x',
      value: 50.5,
      unit: 'cm',
      analyte: '',
      valueText: '',
    })
    expect(r.entries[1]).toMatchObject({ title: 'Weight', value: 3.4, unit: 'kg' })
    expect(r.skipped).toEqual([])
  })

  it('converts US units, pairs blood pressure and reports the half-missing pair', () => {
    const r = build('vitals.csv', suggestMapping(kb, table('vitals.csv'), names))
    const first = r.entries.filter((e) => e.date === '2026-01-05')
    expect(first.map((e) => [e.title, e.value, e.value2 ?? null, e.unit])).toEqual([
      ['Weight', 74.93, null, 'kg'],
      ['Blood glucose', 5.38, null, 'mmol/L'],
      ['Blood pressure', 128, 82, 'mmHg'],
    ])
    expect(first[0].body).toBe('Imported: 165.2 lb')
    // A home spreadsheet's glucose is the glucometer preset; the user can pick the lab test instead.
    expect(first[1]).toMatchObject({ kind: 'measurement', analyte: '' })
    expect(r.skipped).toEqual([{ row: 2, reason: 'pairIncomplete' }])
    expect(r.entries.find((e) => e.date === '2026-01-26' && e.title === 'Weight')?.body).toBe(
      'Imported: 162.9 lb\nafter run, felt fine',
    )
  })

  it('imports a long export once the unknown names are assigned, and refuses an unconvertible unit', () => {
    const t = table('device-export.csv')
    const m = suggestMapping(kb, t, names)
    m.names.HKQuantityTypeIdentifierFlightsClimbed = null
    const r = buildEntries(kb, t, m, { personId: 'kid', source: 'csv:x', existing: [], labTitle })
    expect(r.entries.map((e) => [e.title, e.date, e.time, e.value, e.unit])).toEqual([
      ['Weight', '2026-02-01', '07:31', 71.4, 'kg'],
      ['Weight', '2026-02-08', '07:28', 71.1, 'kg'],
      ['Heart rate', '2026-02-01', '07:33', 62, 'bpm'],
      ['Heart rate', '2026-02-08', '07:30', 58, 'bpm'],
      ['Body temperature', '2026-02-03', '21:00', 37, '°C'],
    ])
    // The file's unit column wins over the one given for the name.
    expect(r.blocked).toEqual([])
    const vitals = suggestMapping(kb, table('vitals.csv'), names)
    vitals.columns[1] = {
      role: 'metric',
      metric: { target: { kind: 'preset', preset: 'weight' }, unit: 'furlongs' },
    }
    const bad = build('vitals.csv', vitals)
    expect(bad.blocked).toEqual([{ label: 'Weight', unit: 'furlongs' }])
    expect(bad.entries.some((e) => e.title === 'Weight')).toBe(false)
  })

  it('adds nothing twice when the same file is imported again', () => {
    const m = suggestMapping(kb, table('growth.csv'), names)
    const once = build('growth.csv', m)
    const saved = once.entries.map(
      (e, i) => ({ ...e, id: `e${i}`, createdAt: 't' }) as unknown as HealthEntry,
    )
    const again = build('growth.csv', m, saved)
    expect(again.entries).toEqual([])
    expect(again.skipped.filter((s) => s.reason === 'duplicate')).toHaveLength(12)
  })
})
