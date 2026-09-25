import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Kb } from '../kb/kb'
import { normaliseRow } from './normalise'
import { parseLabText } from './parseText'
import { labEntries } from './save'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb

describe('labEntries', () => {
  const { draft } = parseLabText(kb, readFileSync(`${__dirname}/fixtures/ru-biochem.txt`, 'utf8'))
  const o = { personId: 'p1', source: 'text:abc', lang: 'ru', fallbackDate: '2026-01-01' }

  it('makes one lab entry per row, as printed, named in the UI language', () => {
    const [glucose] = labEntries(kb, draft, draft.rows, o)
    expect(glucose).toEqual({
      personId: 'p1',
      date: '2026-09-17',
      time: '08:30',
      kind: 'lab',
      title: 'Глюкоза',
      body: 'Биохимический анализ крови\nAs printed: Глюкоза: 6,4 ммоль/л (ref 3,9 - 6,1) ↑',
      source: 'text:abc',
      value: 6.4,
      valueText: '',
      unit: 'mmol/L',
      analyte: 'glucose',
      refLow: 3.9,
      refHigh: 6.1,
      flag: 'H',
    })
    expect(labEntries(kb, draft, draft.rows, { ...o, lang: 'de' })[0].title).toBe('Glucose')
  })

  it('keeps comparators and words as printed, and falls back to the printed name', () => {
    const rows = [
      normaliseRow(kb, { name: 'CRP', value: '<1', unit: 'mg/L' }),
      normaliseRow(kb, { name: 'HBsAg', value: 'negative' }),
    ]
    const [crp, hbs] = labEntries(kb, { date: '', time: '', panel: '', rows }, rows, o)
    expect(crp).toMatchObject({ value: 1, valueText: '<1', unit: 'mg/L', date: '2026-01-01' })
    expect(hbs).toMatchObject({ title: 'HBsAg', value: null, valueText: 'negative', analyte: '' })
  })

  it('trusts a test the user picked by hand', () => {
    const r = normaliseRow(kb, { name: 'Glucose', value: '6.1', unit: '%', analyte: 'hba1c' }, true)
    expect(r).toMatchObject({ analyte: 'hba1c', issues: [] })
  })
})
