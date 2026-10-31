import { describe, expect, it } from 'vitest'
import {
  describeTeeth,
  formatTeeth,
  isMilkTooth,
  MILK_TEETH,
  PERMANENT_TEETH,
  parseTeeth,
  splitTeeth,
  toggleTooth,
  toothType,
} from './teeth'

describe('teeth', () => {
  it('lays out both jaws the FDI way, the person’s right first', () => {
    expect(PERMANENT_TEETH[0]).toEqual([18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28])
    expect(PERMANENT_TEETH[1]).toEqual([48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38])
    expect(MILK_TEETH[0]).toEqual([55, 54, 53, 52, 51, 61, 62, 63, 64, 65])
    expect(MILK_TEETH[1]).toEqual([85, 84, 83, 82, 81, 71, 72, 73, 74, 75])
  })

  it('tells a milk tooth by its number, and the kind of tooth', () => {
    expect(isMilkTooth(55)).toBe(true)
    expect(isMilkTooth(46)).toBe(false)
    expect([11, 13, 14, 16, 54].map(toothType)).toEqual(['incisor', 'canine', 'premolar', 'molar', 'molar'])
  })

  it('stores valid numbers once, ascending, and nothing when none are picked', () => {
    expect(parseTeeth('26 16 x 16 99 55,19')).toEqual([16, 26, 55])
    expect(parseTeeth(true)).toEqual([])
    expect(formatTeeth([26, 16])).toBe('16 26')
    expect(formatTeeth([])).toBeUndefined()
    expect(toggleTooth([16, 26], 16)).toEqual([26])
    expect(toggleTooth([26], 11)).toEqual([11, 26])
  })

  it('names permanent and milk teeth apart for Ask', () => {
    expect(splitTeeth('16 55 26')).toEqual({ permanent: [16, 26], milk: [55] })
    expect(describeTeeth('16 26 55')).toBe('teeth 16, 26 (FDI); milk teeth 55 (FDI)')
    expect(describeTeeth('61')).toBe('milk teeth 61 (FDI)')
    expect(describeTeeth('')).toBe('')
  })
})
