import { describe, expect, it } from 'vitest'
import { childWarp, parsePath, stageOf, warpPath } from './bodyWarp'

describe('body warp', () => {
  it('reads path data into absolute commands', () => {
    expect(parsePath('M10 20l5 5h3v-2.5Z')).toEqual([
      ['M', [10, 20]],
      ['L', [15, 25]],
      ['L', [18, 25]],
      ['L', [18, 22.5]],
      ['Z', []],
    ])
    // Pairs after a relative moveto are relative linetos; numbers may run together.
    expect(parsePath('m1 1 2 2-1.5.5')).toEqual([
      ['M', [1, 1]],
      ['L', [3, 3]],
      ['L', [1.5, 3.5]],
    ])
    expect(parsePath('M0 0c1 1 2 2 3 3 1 1 2 2 3 3')).toEqual([
      ['M', [0, 0]],
      ['C', [1, 1, 2, 2, 3, 3]],
      ['C', [4, 4, 5, 5, 6, 6]],
    ])
  })

  it('reads arc flags written without separators', () => {
    expect(parsePath('M5 5a.35.35 0 01-.59.01')).toEqual([
      ['M', [5, 5]],
      ['A', [0.35, 0.35, 0, 0, 1, 4.41, 5.01]],
    ])
  })

  it('moves every point, and stretches arcs with the space around them', () => {
    const double = {
      at: ([x, y]: [number, number]): [number, number] => [x * 2, y * 2],
      scale: (): [number, number] => [2, 2],
    }
    expect(warpPath('M1 1l1 0a1 1 0 0 1 1 1z', double)).toBe('M2 2L4 2A2 2 0 0 1 6 4Z')
  })

  it('picks the age group, adult when the age is unknown', () => {
    expect([null, 40, 16, 15, 13, 12, 9, 8, 4, 3, 0.5].map(stageOf)).toEqual([
      'adult',
      'adult',
      'adult',
      'teen',
      'teen',
      'child',
      'child',
      'young',
      'young',
      'toddler',
      'toddler',
    ])
  })

  it('keeps the soles and the top of the head where they were, the chin lower for a child', () => {
    const a = { mid: 100, top: 0, chin: 100, crotch: 400, sole: 800, shoulders: 2.7 }
    const { head, body } = childWarp(a, 'toddler')
    expect(body.at([100, 800])[1]).toBeCloseTo(800)
    expect(head.at([100, 0])[1]).toBeCloseTo(0)
    expect(head.at([100, 100])[1]).toBeCloseTo(0.22 * 800)
    expect(body.at([100, 100])[1]).toBeCloseTo(0.22 * 800)
    expect(body.at([100, 400])[1]).toBeCloseTo(800 - 0.4 * 800)
  })
})
