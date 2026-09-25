import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Kb } from '../kb/kb'
import { parseLabText } from './parseText'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb
const fixture = (name: string) => readFileSync(`${__dirname}/fixtures/${name}`, 'utf8')
const parse = (name: string) => parseLabText(kb, fixture(name))
const pick = (rows: { analyte: string | null }[]) => rows.map((r) => r.analyte)

describe('parseLabText', () => {
  it('reads a one-line sugar test and skips the birth date', () => {
    const { draft, candidates } = parse('glucose-slip.txt')
    expect(draft).toMatchObject({ date: '2026-09-18', time: '07:55', panel: 'glucose' })
    expect(draft.rows).toHaveLength(1)
    expect(draft.rows[0]).toMatchObject({
      analyte: 'glucose',
      value: 5.9,
      unit: 'mmol/L',
      refLow: 3.9,
      refHigh: 6.1,
      flag: '',
    })
    expect(candidates).toBe(1)
  })

  it('reads a space-aligned English blood count and tells % from absolute', () => {
    const { draft } = parse('cbc-en.txt')
    expect(draft).toMatchObject({ date: '2026-09-18', time: '08:10', panel: 'cbc' })
    expect(pick(draft.rows)).toEqual([
      'wbc',
      'rbc',
      'hb',
      'hct',
      'mcv',
      'plt',
      'neut_pct',
      'neut_abs',
      'lymph_pct',
      'lymph_abs',
    ])
    expect(draft.rows[0]).toMatchObject({ value: 11.4, flag: 'H', unit: '10^9/L' })
    expect(draft.rows[2]).toMatchObject({ value: 13.9, unit: 'g/dL', canonical: { value: 139, unit: 'g/L' } })
    expect(draft.rows[7]).toMatchObject({ value: 7.75, flag: 'H' })
    expect(draft.rows.every((r) => r.issues.length === 0)).toBe(true)
  })

  it('reads a Russian report with decimal commas, arrows and sections', () => {
    const { draft, candidates } = parse('ru-biochem.txt')
    expect(draft).toMatchObject({ date: '2026-09-17', time: '08:30', panel: '' })
    expect(pick(draft.rows)).toEqual([
      'glucose',
      'chol_total',
      'alt',
      'creatinine',
      'hb',
      'wbc',
      'neut_pct',
      'esr',
    ])
    expect(draft.rows[0]).toMatchObject({ value: 6.4, flag: 'H', unit: 'mmol/L', refLow: 3.9, refHigh: 6.1 })
    expect(draft.rows[1]).toMatchObject({ value: 5.8, flag: 'H', refLow: null, refHigh: 5.2 })
    expect(draft.rows[2]).toMatchObject({ value: 24, unit: 'U/L', refHigh: 41, flag: '' })
    expect(draft.rows[5]).toMatchObject({ value: 6.2, unit: '10^9/L', section: 'Общий анализ крови' })
    expect(draft.rows[0].section).toBe('Биохимический анализ крови')
    expect(candidates).toBe(8)
  })

  it('reads a CSV export by its header, and converts US units', () => {
    const { draft } = parse('lipid-us.csv')
    expect(pick(draft.rows)).toEqual(['chol_total', 'tg', 'hdl', 'ldl'])
    expect(draft.panel).toBe('lipid')
    expect(draft.rows[0]).toMatchObject({ value: 212, unit: 'mg/dL', flag: 'H', refHigh: 200 })
    expect(draft.rows[0].canonical?.value).toBeCloseTo(5.48, 2)
    expect(draft.rows[2]).toMatchObject({ refLow: 39, refHigh: null, flag: '' })
  })

  it('reads a tab-separated export with a Russian header', () => {
    const { draft } = parse('lis-export.tsv')
    expect(pick(draft.rows)).toEqual(['ferritin', 'b12', 'tsh'])
    expect(draft.rows[0]).toMatchObject({ value: 12, unit: 'ng/mL', flag: 'L' })
    expect(draft.rows[2]).toMatchObject({ value: 2.1, unit: 'mIU/L' })
  })

  it('finds nothing in prose, and counts what it could not place', () => {
    const r = parseLabText(kb, 'Dear Dr Smith,\nI saw your patient on 3 occasions.\nKind regards')
    expect(r.draft.rows).toEqual([])
    expect(r.candidates).toBe(1)
  })
})
