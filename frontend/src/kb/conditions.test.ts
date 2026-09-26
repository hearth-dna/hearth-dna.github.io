import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MEASUREMENT_PRESETS } from '../health/presets'
import { BODY_PARTS } from '../types'
import {
  conditionById,
  conditionLabel,
  conditionName,
  matchConditions,
  suggestConditions,
} from './conditions'
import { type Kb, searchKb } from './kb'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb

describe('condition catalogue', () => {
  it('links markers and conditions both ways and references only known presets and body parts', () => {
    const presets = new Set(MEASUREMENT_PRESETS.map((p) => p.id))
    const rsids = new Set(kb.entries.map((e) => e.rsid))
    for (const c of kb.conditions) {
      expect(c.names.en, c.id).toBeTruthy()
      for (const m of c.measurements) expect(presets, `${c.id} measurement ${m}`).toContain(m)
      for (const b of c.body_parts) expect(BODY_PARTS, `${c.id} body part ${b}`).toContain(b)
      for (const r of c.rsids)
        if (rsids.has(r)) expect(kb.entries.find((e) => e.rsid === r)?.conditions).toContain(c.id)
    }
    for (const e of kb.entries)
      for (const id of e.conditions ?? []) expect(conditionById(kb, id)?.rsids, `${e.rsid}`).toContain(e.rsid)
    expect(conditionById(kb, 't2d')?.rsids).toEqual(expect.arrayContaining(['rs7903146', 'rs1801282']))
  })

  it('names a condition in the UI language, falling back to English', () => {
    const t2d = conditionById(kb, 't2d')!
    expect(conditionName(t2d, 'ru')).toBe('Сахарный диабет 2 типа')
    expect(conditionName(t2d, 'ja')).toBe('Type 2 diabetes')
    expect(conditionLabel(kb, 'nope')).toBe('nope')
  })
})

describe('matchConditions', () => {
  it('finds conditions from names, synonyms, lab tests and drugs', () => {
    expect(matchConditions(kb, 'Diagnosed with type 2 diabetes')).toContain('t2d')
    expect(matchConditions(kb, 'HbA1c 6.1 %')).toEqual(['t2d'])
    expect(matchConditions(kb, 'Started metformin 500 mg')).toEqual(['t2d'])
    expect(matchConditions(kb, 'Ferritin 480')).toEqual(['haemochromatosis'])
    expect(matchConditions(kb, 'High blood pressure at the GP')).toContain('hypertension')
  })
  it('reads Russian notes too', () => {
    expect(matchConditions(kb, 'Гликированный гемоглобин 6,1')).toEqual(['t2d'])
    expect(matchConditions(kb, 'Мигрень с утра')).toEqual(['migraine'])
  })
  it('does not guess from symptoms, body parts or filler words alone', () => {
    expect(matchConditions(kb, 'Fatigue')).toEqual([])
    expect(matchConditions(kb, 'Pain in both knees')).toEqual([])
    expect(matchConditions(kb, 'the and with for')).toEqual([])
    expect(matchConditions(kb, '')).toEqual([])
  })
})

describe('kb search with condition ids', () => {
  it('still finds markers by condition name and synonym', () => {
    expect(searchKb(kb, 'diabetes').map((e) => e.rsid)).toContain('rs7903146')
    expect(searchKb(kb, 'heart attack').map((e) => e.rsid)).toContain('rs10757278')
    expect(searchKb(kb, 'целиакия').map((e) => e.gene)).toContain('HLA-DQA1 (DQ2.5 tag)')
  })
})

describe('suggestConditions', () => {
  const e = { title: '', body: '', tags: [] as string[] }
  it('suggests from the words, the lab test and the measurement preset', () => {
    expect(suggestConditions(kb, { ...e, title: 'Started metformin' })).toEqual(['t2d'])
    expect(suggestConditions(kb, { ...e, title: 'Glucose', analyte: 'glucose' })).toContain('t2d')
    expect(suggestConditions(kb, { ...e, title: 'CRP', analyte: 'crp' })).toContain('arthritis')
    expect(suggestConditions(kb, { ...e, title: 'Blood pressure', preset: 'blood-pressure' })).toEqual(
      expect.arrayContaining(['hypertension', 't2d', 'cad']),
    )
    expect(suggestConditions(kb, { ...e, tags: ['migraine'] })).toEqual(['migraine'])
  })
  it('suggests nothing for unrelated text', () => {
    expect(suggestConditions(kb, { ...e, title: 'Walked the dog', body: 'fine day' })).toEqual([])
  })
})
