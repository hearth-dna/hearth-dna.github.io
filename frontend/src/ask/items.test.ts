import { describe, expect, it } from 'vitest'
import type { Finding } from '../kb/kb'
import type { HealthEntry, Person } from '../types'
import { type AskData, itemLabel, packPeople, resolve } from './items'

const person = (id: string): Person => ({
  id,
  label: id,
  displayName: id.toUpperCase(),
  sex: 'unknown',
  birthYear: null,
  notes: '',
  createdAt: '',
})
const finding = {
  entry: { rsid: 'rs1', gene: 'GENE', name: 'n', summary: '', sources: [], evidence: 'A' },
  call: { rsid: 'rs1', chromosome: '1', position: 1, a1: 'A', a2: 'G' },
  match: null,
} as unknown as Finding
const entry = (id: string, date: string) =>
  ({
    id,
    personId: 'b',
    date,
    time: '',
    kind: 'lab',
    title: id,
    tags: [],
    body: '',
  }) as unknown as HealthEntry
const data: AskData = {
  findingsBy: { a: [finding] },
  healthBy: { b: [entry('new', '2026-02-01'), entry('old', '2025-01-01')] },
  rawBy: { a: { rs9: { rsid: 'rs9', chromosome: '3', position: 7, a1: 'T', a2: 'T' } } },
}

describe('ask items', () => {
  it('resolves each kind of key and labels it', () => {
    expect(itemLabel(resolve('f:a:rs1', data)!, 'undescribed')).toBe('GENE rs1 A/G — undescribed')
    expect(itemLabel(resolve('g:a:rs9', data)!, '')).toBe('rs9 T/T (chr3:7)')
    expect(resolve('h:b:missing', data)).toBeNull()
  })
  it('groups by selected person in family order, health newest first', () => {
    const people = packPeople(
      ['h:b:old', 'g:a:rs9', 'h:b:new', 'f:a:rs1', 'f:c:rs1'],
      data,
      [person('a'), person('b'), person('c')],
      ['b', 'a'],
    )
    expect(
      people.map((p) => [p.person.id, p.findings.length, p.genotypes?.length, p.health?.map((h) => h.id)]),
    ).toEqual([
      ['a', 1, 1, []],
      ['b', 0, 0, ['new', 'old']],
    ])
  })
})
