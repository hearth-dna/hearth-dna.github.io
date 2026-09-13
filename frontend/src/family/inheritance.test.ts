import { describe, expect, it } from 'vitest'
import type { Call, Person } from '../types'
import { alleleOrigins, layoutPedigree } from './inheritance'

const c = (g: string): Call => ({ rsid: 'rs1', chromosome: '1', position: 1, a1: g[0], a2: g[1] })
const from = (child: string, mum?: string, dad?: string) =>
  alleleOrigins(c(child), [
    { id: 'mum', call: mum ? c(mum) : undefined },
    { id: 'dad', call: dad ? c(dad) : undefined },
  ]).map((o) => o.from)

describe('alleleOrigins', () => {
  it('phases a heterozygous child from two homozygous parents', () => {
    expect(from('AG', 'AA', 'GG')).toEqual(['mum', 'dad'])
    expect(from('GA', 'AA', 'GG')).toEqual(['dad', 'mum'])
  })
  it('phases when only one assignment fits', () => {
    expect(from('AG', 'AG', 'GG')).toEqual(['mum', 'dad']) // dad cannot give A
  })
  it('attributes homozygous children to both parents', () => {
    expect(from('AA', 'AG', 'AG')).toEqual(['mum', 'dad'])
  })
  it('is ambiguous when both parents are heterozygous', () => {
    expect(from('AG', 'AG', 'AG')).toEqual(['ambiguous', 'ambiguous'])
  })
  it('flags impossible pairs', () => {
    expect(from('AA', 'GG', 'AG')).toEqual(['impossible', 'impossible'])
    expect(from('TT', 'CC')).toEqual(['impossible', 'impossible'])
  })
  it('handles one typed parent', () => {
    expect(from('AG', 'AA')).toEqual(['mum', 'dad']) // G must be dad's, though untyped
    expect(from('AG', undefined, 'GG')).toEqual(['mum', 'dad'])
    expect(from('AG', 'AG')).toEqual(['ambiguous', 'ambiguous'])
    expect(from('AA', 'AG')).toEqual(['mum', 'dad'])
  })
  it('returns nothing for no-calls and marks untyped parents', () => {
    expect(from('A-', 'AA', 'GG')).toEqual([])
    expect(from('AG')).toEqual(['untyped', 'untyped'])
  })
})

describe('layoutPedigree', () => {
  const p = (id: string, createdAt: string): Person => ({
    id,
    label: id,
    displayName: id,
    sex: 'unknown',
    birthYear: null,
    notes: '',
    createdAt,
  })
  it('puts founders on top and children under the mean of their parents', () => {
    const nodes = layoutPedigree(
      [p('kid', '3'), p('gran', '0'), p('mum', '1'), p('dad', '2'), p('uncle', '4')],
      [
        { parentId: 'gran', childId: 'mum' },
        { parentId: 'gran', childId: 'uncle' },
        { parentId: 'mum', childId: 'kid' },
        { parentId: 'dad', childId: 'kid' },
      ],
    )
    const at = (id: string) => nodes.find((n) => n.person.id === id)!
    expect([at('gran').generation, at('dad').generation, at('mum').generation, at('kid').generation]).toEqual(
      [0, 0, 1, 2],
    )
    expect(at('mum').column).toBeLessThan(at('uncle').column) // both under gran; creation order
    expect(at('kid').parents.sort()).toEqual(['dad', 'mum'])
  })
})
