import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Kb } from '../kb/kb'
import { labDraftFromJson, labPrompt, labSchema } from './prompt'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb
const reply = readFileSync(`${__dirname}/fixtures/gemini-cbc-ru.json`, 'utf8')

describe('lab prompt and schema', () => {
  it('offers every catalogue id, plus "other", as the analyte enum', () => {
    const schema = labSchema(kb) as {
      properties: { results: { items: { properties: { analyte: { enum: string[] } } } } }
    }
    const ids = schema.properties.results.items.properties.analyte.enum
    expect(ids).toHaveLength(kb.analytes.length + 1)
    expect(ids).toContain('hba1c')
    expect(ids).toContain('other')
  })
  it('lists the tests and forbids converting', () => {
    const p = labPrompt(kb)
    expect(p).toContain('glucose: Glucose / GLU, GLUC [mmol/L]')
    expect(p).toContain('Do not convert units')
  })
})

describe('labDraftFromJson', () => {
  const draft = labDraftFromJson(kb, reply)
  const by = (name: string) => draft.rows.find((r) => r.printedName.startsWith(name))!

  it('keeps the report date, time and panel', () => {
    expect(draft).toMatchObject({ date: '2026-09-18', time: '08:40', panel: 'cbc' })
    expect(draft.rows).toHaveLength(8)
  })
  it('reads Russian units, decimal commas and flags', () => {
    expect(by('Гемоглобин')).toMatchObject({
      analyte: 'hb',
      value: 128,
      unit: 'g/L',
      refLow: 120,
      refHigh: 140,
      flag: '',
    })
    expect(by('Эритроциты')).toMatchObject({ analyte: 'rbc', value: 4.31, unit: '10^12/L' })
    expect(by('Лейкоциты')).toMatchObject({ analyte: 'wbc', value: 11.2, flag: 'H', issues: [] })
  })
  it('corrects a model pick the name and unit contradict', () => {
    // The model said neut_pct; the name and 10^9/L say absolute.
    expect(by('Нейтрофилы, абс')).toMatchObject({ analyte: 'neut_abs', value: 8.06, flag: 'H', issues: [] })
    expect(by('Нейтрофилы, %')).toMatchObject({ analyte: 'neut_pct', value: 72 })
  })
  it('computes a flag the paper left out', () => {
    expect(by('СОЭ')).toMatchObject({ analyte: 'esr', value: 18, flag: 'H' })
  })
  it('marks what the user must check', () => {
    expect(by('Тромбоциты').issues).toEqual(['implausible'])
    expect(by('Ретикулоциты')).toMatchObject({ analyte: 'retic', issues: [] })
  })
  it('survives a sparse reply', () => {
    expect(labDraftFromJson(kb, '{"results":[{"printed_name":"Glucose","value":"5.1"}]}')).toMatchObject({
      date: '',
      time: '',
      panel: '',
      rows: [{ analyte: 'glucose', value: 5.1 }],
    })
  })
})
