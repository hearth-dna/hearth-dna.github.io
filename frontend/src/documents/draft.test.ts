import { describe, expect, it } from 'vitest'
import { documentPrompt, draftFromJson } from './draft'

describe('draftFromJson', () => {
  it('folds lab values into the body and keeps a valid kind and date', () => {
    const d = draftFromJson(
      JSON.stringify({
        date: '2026-05-01',
        kind: 'lab',
        title: 'Lipid panel',
        body: 'Fasting sample.',
        values: [
          { name: 'LDL', value: '4.1', unit: 'mmol/L', ref: '< 3.0' },
          { name: 'HDL', value: '1.2' },
        ],
      }),
      '2026-09-13',
    )
    expect(d).toEqual({
      date: '2026-05-01',
      kind: 'lab',
      title: 'Lipid panel',
      body: 'Fasting sample.\n\nLDL: 4.1 mmol/L (ref < 3.0)\nHDL: 1.2',
    })
  })
  it('falls back on bad date, unknown kind and empty title', () => {
    const d = draftFromJson(
      '{"date":"May 2026","kind":"xray","title":"","body":"ok","values":[]}',
      '2026-09-13',
    )
    expect(d).toEqual({ date: '2026-09-13', kind: 'other', title: 'Untitled document', body: 'ok' })
  })
  it('asks for transcription only and to drop identifiers', () => {
    const p = documentPrompt('imaging')
    expect(p).toContain('imaging report')
    expect(p).toMatch(/Do not add interpretation/)
    expect(p).toMatch(/Leave out patient name/)
  })
})
