import { bodyOf, type Figure, H, MID, W } from './bodyFigure'
import { parsePath, STAGES } from './bodyWarp'
import { LAYOUT as TEETH, H as TEETH_H, W as TEETH_W } from './ToothChart'

/**
 * The body map's figures and the tooth chart's layout for the phone apps, as one JSON file
 * (`make mobile-assets` copies it in): every figure the web draws, already reshaped and placed,
 * its paths in scene coordinates with only M, L, C, Q and Z, so a phone only has to draw them.
 * mobileFigures.test.ts keeps the committed file equal to what this builds.
 */

type Pt = [number, number]
const r1 = (x: number) => Math.round(x * 10) / 10
/** Whole units: the scene is about four times a phone's width in points, so well under a point. */
const r0 = (x: number) => Math.round(x) + 0

/**
 * One SVG arc (from `p0`, absolute end point `p`) as cubic curves, after the SVG spec's
 * endpoint-to-centre conversion (appendix B.2.4); a quarter turn or less per curve.
 */
function arcToCubics(p0: Pt, rx0: number, ry0: number, rot: number, large: number, sweep: number, p: Pt) {
  if (rx0 === 0 || ry0 === 0 || (p0[0] === p[0] && p0[1] === p[1])) return [[...p0, ...p, ...p]]
  const phi = (rot * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (p0[0] - p[0]) / 2
  const dy = (p0[1] - p[1]) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  let rx = Math.abs(rx0)
  let ry = Math.abs(ry0)
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cx1 = (coef * rx * y1) / ry
  const cy1 = (-coef * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p[0]) / 2
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p[1]) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)))
  const step = dt / n
  const k = (4 / 3) * Math.tan(step / 4)
  const at = (t: number): Pt => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ]
  const tangent = (t: number): Pt => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ]
  const out: number[][] = []
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step
    const b = a + step
    const pa = at(a)
    const pb = at(b)
    const ta = tangent(a)
    const tb = tangent(b)
    out.push([pa[0] + k * ta[0], pa[1] + k * ta[1], pb[0] - k * tb[0], pb[1] - k * tb[1], pb[0], pb[1]])
  }
  // The last point lands exactly on the end, whatever rounding did.
  out[out.length - 1].splice(4, 2, p[0], p[1])
  return out
}

/** Path data in M, L, C, Q and Z only, every point moved by `f`, rounded by `round`. */
export function simplePath(d: string, f: (p: Pt) => Pt, round = r1): string {
  let cur: Pt = [0, 0]
  let start: Pt = [0, 0]
  const pts = (nums: number[]) => {
    const out: number[] = []
    for (let i = 0; i < nums.length; i += 2) out.push(...f([nums[i], nums[i + 1]]).map(round))
    return out.join(' ')
  }
  const parts: string[] = []
  for (const [c, a] of parsePath(d)) {
    if (c === 'Z') {
      parts.push('Z')
      cur = start
    } else if (c === 'A') {
      const end: Pt = [a[5], a[6]]
      for (const cubic of arcToCubics(cur, a[0], a[1], a[2], a[3], a[4], end)) parts.push(`C${pts(cubic)}`)
      cur = end
    } else {
      parts.push(c + pts(a))
      cur = [a[a.length - 2], a[a.length - 1]]
      if (c === 'M') start = cur
    }
  }
  return parts.join('')
}

export function mobileFigures() {
  const figures: Record<string, unknown> = {}
  for (const figure of ['male', 'female'] as Figure[])
    for (const stage of STAGES) {
      const body = bodyOf(figure, stage)
      figures[`${figure}-${stage}`] = body.regions.map((r) => {
        const { k, dx, dy } = body.place[r.view]
        const place = ([x, y]: Pt): Pt => [x * k + dx, y * k + dy]
        return {
          part: r.part,
          side: r.side,
          view: r.view,
          ...(r.pieces.some((p) => p.overlay) ? { overlay: true } : {}),
          box: r.box.map(r0),
          d: r.pieces.map((p) => simplePath(p.d, place, r0)),
        }
      })
    }
  const teeth = (spots: (typeof TEETH)['permanent']) =>
    spots.map((s) => ({ n: s.n, x: r1(s.x), y: r1(s.y), angle: r1(s.angle), size: r1(s.size) }))
  return {
    scene: { w: W, h: H, mid: MID },
    figures,
    teeth: { w: TEETH_W, h: TEETH_H, permanent: teeth(TEETH.permanent), milk: teeth(TEETH.milk) },
  }
}
