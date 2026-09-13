import { describe, expect, it } from 'vitest'
import type { Call } from '../types'
import { mendelianCheck, sharedGenotypeRate, toMap } from './mendelian'

const c = (rsid: string, g: string, chr = '1'): Call => ({
  rsid,
  chromosome: chr,
  position: 1,
  a1: g[0],
  a2: g[1],
})

describe('mendelianCheck', () => {
  it('accepts consistent trios and flags impossible ones', () => {
    const child = toMap([c('rs1', 'AG'), c('rs2', 'CC'), c('rs3', 'TT'), c('rsX', 'AG', 'X')])
    const mum = toMap([c('rs1', 'AA'), c('rs2', 'CT'), c('rs3', 'CC'), c('rsX', 'AA', 'X')])
    const dad = toMap([c('rs1', 'GG'), c('rs2', 'CC'), c('rs3', 'TT')])
    const r = mendelianCheck(child, mum, dad)
    expect(r.compared).toBe(3) // X excluded, all three autosomal shared
    expect(r.violations).toBe(1) // rs3: child TT, mum CC cannot give T
    const single = mendelianCheck(child, dad)
    expect(single.violations).toBe(0)
  })
  it('skips no-calls', () => {
    const r = mendelianCheck(toMap([c('rs1', 'A-')]), toMap([c('rs1', 'GG')]))
    expect(r.compared).toBe(0)
  })
})

describe('sharedGenotypeRate', () => {
  it('counts identical genotypes order-independently', () => {
    const r = sharedGenotypeRate(
      toMap([c('rs1', 'AG'), c('rs2', 'CC')]),
      toMap([c('rs1', 'GA'), c('rs2', 'CT')]),
    )
    expect(r).toEqual({ compared: 2, identical: 1 })
  })
})
