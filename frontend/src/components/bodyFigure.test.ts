import { describe, expect, it } from 'vitest'
import { PAIRED } from '../health/body'
import { BODY_PARTS } from '../types'
import { REGIONS } from './bodyFigure'

describe('body figure', () => {
  it('draws every body part but the ones with no place, each paired one on both sides', () => {
    const drawn = new Set(REGIONS.map((r) => r.part))
    expect(BODY_PARTS.filter((p) => !drawn.has(p))).toEqual(['skin', 'joints', 'muscles', 'whole body'])
    for (const r of REGIONS) expect(BODY_PARTS, r.part).toContain(r.part)
    for (const p of PAIRED)
      for (const view of ['front', 'back'] as const) {
        const sides = REGIONS.filter((r) => r.part === p && r.view === view).map((r) => r.side)
        if (sides.length) expect(sides.sort(), `${view} ${p}`).toEqual(['left', 'right'])
      }
  })

  it("puts the person's right on the viewer's left from the front, and on the right from behind", () => {
    const at = (view: 'front' | 'back', side: 'left' | 'right') =>
      REGIONS.find((r) => r.part === 'feet' && r.view === view && r.side === side)?.box[0] ?? Number.NaN
    expect(at('front', 'right')).toBeLessThan(at('front', 'left'))
    expect(at('back', 'right')).toBeGreaterThan(at('back', 'left'))
  })
})
