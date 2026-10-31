import { describe, expect, it } from 'vitest'
import { PAIRED } from '../health/body'
import { BODY_PARTS } from '../types'
import { bodyOf, type Figure, type Region } from './bodyFigure'
import { STAGES } from './bodyWarp'

const ALL = (['male', 'female'] as Figure[]).flatMap((f) =>
  STAGES.map((s) => ({ f, s, rs: bodyOf(f, s).regions })),
)

describe('body figure', () => {
  it('draws every body part but the ones with no place, each paired one on both sides', () => {
    for (const { f, s, rs } of ALL) {
      const drawn = new Set(rs.map((r) => r.part))
      expect(
        BODY_PARTS.filter((p) => !drawn.has(p)),
        `${f} ${s}`,
      ).toEqual(['skin', 'joints', 'muscles', 'whole body'])
      for (const p of PAIRED)
        for (const view of ['front', 'back'] as const) {
          const sides = rs.filter((r) => r.part === p && r.view === view).map((r) => r.side)
          if (sides.length) expect(sides.sort(), `${f} ${s} ${view} ${p}`).toEqual(['left', 'right'])
        }
    }
  })

  it("puts the person's right on the viewer's left from the front, and on the right from behind", () => {
    for (const { f, s, rs } of ALL) {
      const at = (view: 'front' | 'back', side: 'left' | 'right') =>
        rs.find((r) => r.part === 'feet' && r.view === view && r.side === side)?.box[0] ?? Number.NaN
      expect(at('front', 'right'), `${f} ${s}`).toBeLessThan(at('front', 'left'))
      expect(at('back', 'right'), `${f} ${s}`).toBeGreaterThan(at('back', 'left'))
    }
  })

  it('fits each view in its half of the scene, standing on the same ground', () => {
    for (const { f, s, rs } of ALL) {
      const box = (view: 'front' | 'back') => {
        const b = rs.filter((r) => r.view === view).map((r) => r.box)
        return [
          Math.min(...b.map((x) => x[0])),
          Math.max(...b.map((x) => x[2])),
          Math.max(...b.map((x) => x[3])),
        ]
      }
      expect(box('front')[1], `${f} ${s}`).toBeLessThan(724)
      expect(box('back')[0], `${f} ${s}`).toBeGreaterThan(724)
      expect(box('back')[1], `${f} ${s}`).toBeLessThan(1448)
      expect(box('front')[2], `${f} ${s}`).toBeCloseTo(1345, 0)
    }
  })

  it('draws a child with a larger head for the height than an adult', () => {
    const headShare = (rs: Region[]) => {
      const front = rs.filter((r) => r.view === 'front')
      const head = front.filter((r) => r.part === 'head').map((r) => r.box)
      const top = Math.min(...front.map((r) => r.box[1]))
      const bottom = Math.max(...front.map((r) => r.box[3]))
      return (Math.max(...head.map((b) => b[3])) - Math.min(...head.map((b) => b[1]))) / (bottom - top)
    }
    for (const f of ['male', 'female'] as Figure[])
      expect(headShare(bodyOf(f, 'toddler').regions)).toBeGreaterThan(
        headShare(bodyOf(f, 'adult').regions) * 1.4,
      )
  })
})
