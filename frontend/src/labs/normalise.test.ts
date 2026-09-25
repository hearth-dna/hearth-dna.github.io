import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Kb } from '../kb/kb'
import {
  CONVERSIONS,
  normaliseRow,
  normaliseUnit,
  parseFlag,
  parseRef,
  parseValue,
  recogniseAnalyte,
} from './normalise'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb
const row = (name: string, value: string, unit = '', ref = '', flag = '', analyte?: string) =>
  normaliseRow(kb, { name, value, unit, ref, flag, analyte })

describe('lab catalogue', () => {
  it('has a named conversion for every analyte that asks for one', () => {
    for (const a of kb.analytes) if (a.convert) expect(CONVERSIONS[a.convert], a.id).toBeDefined()
  })
  it('names every analyte in English and uses only known units and panels', () => {
    const units = new Set(kb.units.map((u) => u.id))
    const panels = new Set(kb.panels.map((p) => p.id))
    for (const a of kb.analytes) {
      expect(a.names.en, a.id).toBeTruthy()
      for (const u of [a.unit, ...Object.keys(a.units)]) expect(units, `${a.id} ${u}`).toContain(u)
      for (const p of a.panels) expect(panels, `${a.id} ${p}`).toContain(p)
    }
    for (const c of kb.conditions)
      for (const l of c.labs)
        expect(
          kb.analytes.map((a) => a.id),
          c.id,
        ).toContain(l)
  })
})

describe('units', () => {
  it('reads printed spellings in several scripts', () => {
    expect(normaliseUnit(kb, 'ммоль/л')).toBe('mmol/L')
    expect(normaliseUnit(kb, 'mg/dl')).toBe('mg/dL')
    expect(normaliseUnit(kb, '×10⁹/л')).toBe('10^9/L')
    expect(normaliseUnit(kb, 'x10E12/L')).toBe('10^12/L')
    expect(normaliseUnit(kb, 'тыс/мкл')).toBe('10^9/L')
    expect(normaliseUnit(kb, 'Ед/л')).toBe('U/L')
    expect(normaliseUnit(kb, 'мкМЕ/мл')).toBe('mIU/L')
    expect(normaliseUnit(kb, 'μmol/L')).toBe('µmol/L')
    expect(normaliseUnit(kb, 'furlongs')).toBe('')
    expect(normaliseUnit(kb, '')).toBe('')
  })
})

describe('values, ranges and flags', () => {
  it('parses decimal commas, thousands and comparators', () => {
    expect(parseValue('5,4')).toEqual({ value: 5.4, comparator: '', text: '' })
    expect(parseValue('1 234,5')).toEqual({ value: 1234.5, comparator: '', text: '' })
    expect(parseValue('<0.5')).toEqual({ value: 0.5, comparator: '<', text: '' })
    expect(parseValue('≥ 90')).toEqual({ value: 90, comparator: '>=', text: '' })
    expect(parseValue('не обнаружено')).toEqual({ value: null, comparator: '', text: 'не обнаружено' })
  })
  it('parses printed reference ranges', () => {
    expect(parseRef('3,9 - 6,1')).toEqual({ low: 3.9, high: 6.1 })
    expect(parseRef('3.9–6.1')).toEqual({ low: 3.9, high: 6.1 })
    expect(parseRef('до 5,2')).toEqual({ low: null, high: 5.2 })
    expect(parseRef('<5.2')).toEqual({ low: null, high: 5.2 })
    expect(parseRef('>1.0')).toEqual({ low: 1, high: null })
    expect(parseRef('М: 130-160')).toEqual({ low: 130, high: 160 })
    expect(parseRef('')).toEqual({ low: null, high: null })
  })
  it('reads printed flags', () => {
    expect(parseFlag('↑')).toBe('H')
    expect(parseFlag('L')).toBe('L')
    expect(parseFlag('ниже')).toBe('L')
    expect(parseFlag('')).toBe('')
  })
})

describe('recognising the test', () => {
  const id = (name: string, unit = '', hint?: string) => recogniseAnalyte(kb, name, unit, hint).analyte
  it('matches names, synonyms and abbreviations in English and Russian', () => {
    expect(id('Glucose')).toBe('glucose')
    expect(id('Глюкоза')).toBe('glucose')
    expect(id('GLU')).toBe('glucose')
    expect(id('Гемоглобин (HGB)')).toBe('hb')
    expect(id('АЛТ')).toBe('alt')
    expect(id('Холестерин ЛПНП')).toBe('ldl')
    expect(id('Glucose, fasting')).toBe('glucose')
  })
  it('tells a percentage from an absolute count by the unit', () => {
    expect(id('Neutrophils', '%')).toBe('neut_pct')
    expect(id('Neutrophils', '10^9/L')).toBe('neut_abs')
    expect(id('Лимфоциты', '10^9/L')).toBe('lymph_abs')
    expect(id('NEUT#')).toBe('neut_abs')
  })
  it('uses the reader’s guess only when the name says nothing, and checks its unit', () => {
    expect(recogniseAnalyte(kb, 'Thyrotropic hormone, 3rd gen', 'mIU/L', 'tsh')).toEqual({ analyte: 'tsh' })
    expect(recogniseAnalyte(kb, 'Mystery marker', 'g/L', 'tsh')).toEqual({
      analyte: 'tsh',
      issue: 'unitMismatch',
    })
    expect(recogniseAnalyte(kb, 'Mystery marker', '', 'not-an-id')).toEqual({
      analyte: null,
      issue: 'unknownAnalyte',
    })
  })
})

describe('normaliseRow', () => {
  it('converts into the canonical unit', () => {
    expect(row('Glucose', '97', 'mg/dL').canonical?.value).toBeCloseTo(5.38, 2)
    expect(row('Cholesterol', '200', 'mg/dL').canonical?.value).toBeCloseTo(5.17, 2)
    expect(row('Triglycerides', '150', 'mg/dL').canonical?.value).toBeCloseTo(1.69, 2)
    expect(row('Creatinine', '1.0', 'mg/dL').canonical?.value).toBeCloseTo(88.4, 1)
    expect(row('Hemoglobin', '14', 'g/dL').canonical).toEqual({ value: 140, unit: 'g/L' })
    expect(row('HbA1c', '48', 'mmol/mol').canonical?.value).toBeCloseTo(6.54, 2)
    expect(row('HbA1c', '6.1', '%').canonical).toEqual({ value: 6.1, unit: '%' })
  })
  it('keeps a result without an exact conversion as printed', () => {
    const r = row('Lp(a)', '30', 'mg/dL')
    expect(r).toMatchObject({ analyte: 'lpa', value: 30, unit: 'mg/dL', canonical: null, issues: [] })
  })
  it('reads a unit-less result in the canonical unit', () => {
    expect(row('INR', '2,4').canonical).toEqual({ value: 2.4, unit: 'ratio' })
  })
  it('flags from the printed flag, else from the printed range', () => {
    expect(row('Глюкоза', '6,8', 'ммоль/л', '3,9 - 6,1', '↑').flag).toBe('H')
    expect(row('Glucose', '6.8', 'mmol/L', '3.9-6.1').flag).toBe('H')
    expect(row('Ferritin', '8', 'ng/mL', '15-150').flag).toBe('L')
    expect(row('CRP', '<1', 'mg/L', '0-5').flag).toBe('')
  })
  it('marks what the user must check', () => {
    expect(row('Glucose', '540', 'mmol/L').issues).toEqual(['implausible'])
    expect(row('Glucose', '5.4', 'bananas').issues).toEqual(['unknownUnit'])
    expect(row('Glucose', '5.4', '%').issues).toEqual(['unitMismatch'])
    expect(row('Frobnication index', '3').issues).toEqual(['unknownAnalyte'])
  })
  it('keeps what was printed next to what was understood', () => {
    expect(row('  Глюкоза ', ' 5,4 ', 'ммоль/л', '3,9 - 6,1')).toMatchObject({
      printedName: 'Глюкоза',
      printedValue: '5,4',
      printedUnit: 'ммоль/л',
      printedRef: '3,9 - 6,1',
      analyte: 'glucose',
      value: 5.4,
      unit: 'mmol/L',
      refLow: 3.9,
      refHigh: 6.1,
      flag: '',
      canonical: { value: 5.4, unit: 'mmol/L' },
    })
  })
})
