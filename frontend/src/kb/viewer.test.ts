import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Person } from '../types'
import { computeFindings, type Kb } from './kb'
import { NO_VIEWER_FILTER, rankEntries, viewerPackPeople, viewerQuestion, viewerRows } from './viewer'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb

const person = (id: string): Person => ({
  id,
  label: id,
  displayName: id,
  sex: 'unknown',
  birthYear: null,
  birthDate: '',
  notes: '',
  createdAt: '',
})
const call = (rsid: string, a1: string, a2: string) => ({ rsid, chromosome: '1', position: 1, a1, a2 })

describe('areas', () => {
  it('gives every marker a known area and names every area in English', () => {
    const ids = new Set(kb.areas.map((a) => a.id))
    for (const a of kb.areas) expect(a.names.en, a.id).toBeTruthy()
    for (const e of kb.entries) {
      expect(e.areas.length, e.rsid).toBeGreaterThan(0)
      for (const a of e.areas) expect(ids, `${e.rsid} area ${a}`).toContain(a)
    }
  })
  it('covers the areas people ask about', () => {
    const inArea = (id: string) => kb.entries.filter((e) => e.areas.includes(id)).map((e) => e.gene)
    expect(inArea('diabetes')).toEqual(expect.arrayContaining(['TCF7L2', 'FTO']))
    expect(inArea('memory')).toEqual(expect.arrayContaining(['APOE', 'BDNF']))
    expect(inArea('mental')).toEqual(expect.arrayContaining(['COMT', 'FKBP5', 'CYP2D6']))
    expect(inArea('fitness')).toContain('ACTN3')
  })
})

describe('rankEntries', () => {
  it('puts established, medical, high-impact markers first', () => {
    const ranked = rankEntries(kb)
    expect(ranked).toHaveLength(kb.entries.length)
    const grades = ranked.map((e) => e.evidence).join('')
    expect(grades).toBe([...grades].sort().join(''))
    expect(ranked[0].evidence).toBe('A')
    expect(ranked[0].topic).not.toBe('brain_and_body')
  })
})

describe('viewerRows', () => {
  const findingsBy = {
    a: computeFindings(kb, [call('rs7903146', 'T', 'T'), call('rs4680', 'A', 'G')]),
    b: computeFindings(kb, [call('rs7903146', 'C', 'C')]),
  }
  it('shows every marker by default, with genotypes where people have them', () => {
    const rows = viewerRows(kb, findingsBy, ['a', 'b'], NO_VIEWER_FILTER)
    expect(rows).toHaveLength(kb.entries.length)
    const tcf = rows.find((r) => r.entry.rsid === 'rs7903146')!
    expect(Object.keys(tcf.findings)).toEqual(['a', 'b'])
    expect(rows.find((r) => r.entry.rsid === 'rs4680')!.findings.b).toBeUndefined()
  })
  it('filters by area, text and notability', () => {
    const ids = (f: Partial<typeof NO_VIEWER_FILTER>, people = ['a', 'b']) =>
      viewerRows(kb, findingsBy, people, { ...NO_VIEWER_FILTER, ...f }).map((r) => r.entry.rsid)
    expect(ids({ areas: ['diabetes'] })).toContain('rs7903146')
    expect(ids({ areas: ['diabetes'] })).not.toContain('rs4680')
    expect(ids({ areas: ['diabetes', 'mental'] })).toEqual(expect.arrayContaining(['rs7903146', 'rs4680']))
    expect(ids({ query: 'TCF7L2' })).toEqual(['rs7903146'])
    expect(ids({ notable: true })).toEqual(['rs7903146'])
    expect(ids({ notable: true }, ['b'])).toEqual([])
  })
})

describe('viewer pack', () => {
  it('packs only shown people who have genotypes in the rows', () => {
    const rows = viewerRows(kb, { a: computeFindings(kb, [call('rs7903146', 'C', 'T')]) }, ['a', 'b'], {
      ...NO_VIEWER_FILTER,
      areas: ['diabetes'],
    })
    const packed = viewerPackPeople(rows, [person('a'), person('b')])
    expect(packed.map((p) => p.person.id)).toEqual(['a'])
    expect(packed[0].findings.map((f) => f.entry.rsid)).toEqual(['rs7903146'])
  })
  it('asks about the chosen areas in English', () => {
    expect(viewerQuestion(kb, ['memory', 'diabetes'])).toMatch(
      /^What do these genotypes mean for diabetes and weight, memory/,
    )
    expect(viewerQuestion(kb, [])).toMatch(/^What do these genotypes mean,/)
  })
})
