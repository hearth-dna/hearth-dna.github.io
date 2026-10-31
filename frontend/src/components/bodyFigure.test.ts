import { describe, expect, it } from 'vitest'
import { PAIRED } from '../health/body'
import { BODY_PARTS } from '../types'
import { type Figure, REGIONS } from './bodyFigure'

const FIGURES: Figure[] = ['male', 'female']

describe('body figure', () => {
  it('draws every body part but the ones with no place, each paired one on both sides', () => {
    for (const f of FIGURES) {
      const drawn = new Set(REGIONS[f].map((r) => r.part))
      expect(
        BODY_PARTS.filter((p) => !drawn.has(p)),
        f,
      ).toEqual(['skin', 'joints', 'muscles', 'whole body'])
      for (const r of REGIONS[f]) expect(BODY_PARTS, r.part).toContain(r.part)
      for (const p of PAIRED)
        for (const view of ['front', 'back'] as const) {
          const sides = REGIONS[f].filter((r) => r.part === p && r.view === view).map((r) => r.side)
          if (sides.length) expect(sides.sort(), `${f} ${view} ${p}`).toEqual(['left', 'right'])
        }
    }
  })

  it("puts the person's right on the viewer's left from the front, and on the right from behind", () => {
    for (const f of FIGURES) {
      const at = (view: 'front' | 'back', side: 'left' | 'right') =>
        REGIONS[f].find((r) => r.part === 'feet' && r.view === view && r.side === side)?.box[0] ?? Number.NaN
      expect(at('front', 'right'), f).toBeLessThan(at('front', 'left'))
      expect(at('back', 'right'), f).toBeGreaterThan(at('back', 'left'))
    }
  })

  it('places both figures in the same scene, front left of back', () => {
    for (const f of FIGURES) {
      const xs = (view: 'front' | 'back') =>
        REGIONS[f].filter((r) => r.view === view).flatMap((r) => [r.box[0], r.box[2]])
      expect(Math.max(...xs('front')), f).toBeLessThan(724)
      expect(Math.min(...xs('back')), f).toBeGreaterThan(724)
      expect(Math.max(...xs('back')), f).toBeLessThan(1448)
    }
  })
})
