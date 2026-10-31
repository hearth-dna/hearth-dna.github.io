/**
 * Children's bodies from the adult drawings: every point of an outline is moved so the head is
 * larger, the legs shorter and the build narrower, by age. The drawings have no children, and a
 * point-by-point warp keeps the pieces meeting where they met.
 */

type Pt = [number, number]
/** Moves a point; `scale` is how much the space around it is stretched (for arc radii). */
export interface Warp {
  at: (p: Pt) => Pt
  scale: (p: Pt) => Pt
}

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }

/** Path data → commands with absolute numbers; H and V become L. Arc flags may run together ("01"). */
export function parsePath(d: string): [string, number[]][] {
  const out: [string, number[]][] = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g
  const tokens: (string | number)[] = []
  let cmd = ''
  let argIndex = 0
  // Arc flags are single digits that may be written without separators, so read them by hand.
  for (let i = 0; i < d.length; ) {
    const ch = d[i]
    if (/[\s,]/.test(ch)) {
      i++
      continue
    }
    if (/[A-Za-z]/.test(ch)) {
      tokens.push(ch)
      cmd = ch.toLowerCase()
      argIndex = 0
      i++
      continue
    }
    const pos = argIndex % (ARGS[cmd] || 1)
    if (cmd === 'a' && (pos === 3 || pos === 4)) {
      tokens.push(Number(ch))
      argIndex++
      i++
      continue
    }
    re.lastIndex = i
    const m = re.exec(d)
    if (!m || m.index !== i || m[2] === undefined) throw new Error(`bad path at ${i}`)
    tokens.push(Number(m[2]))
    argIndex++
    i += m[0].length
  }
  let cur: Pt = [0, 0]
  let start: Pt = [0, 0]
  let t = 0
  let c = ''
  while (t < tokens.length) {
    if (typeof tokens[t] === 'string') c = tokens[t++] as string
    const lower = c.toLowerCase()
    const rel = c !== c.toUpperCase()
    if (lower === 'z') {
      out.push(['Z', []])
      cur = start
      continue
    }
    const n = ARGS[lower]
    const a = tokens.slice(t, t + n) as number[]
    t += n
    const abs = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y])
    if (lower === 'm') {
      cur = abs(a[0], a[1])
      start = cur
      out.push(['M', [...cur]])
      // Pairs after a moveto are linetos.
      c = rel ? 'l' : 'L'
    } else if (lower === 'l' || lower === 't') {
      cur = abs(a[0], a[1])
      out.push([lower.toUpperCase(), [...cur]])
    } else if (lower === 'h') {
      cur = [rel ? cur[0] + a[0] : a[0], cur[1]]
      out.push(['L', [...cur]])
    } else if (lower === 'v') {
      cur = [cur[0], rel ? cur[1] + a[0] : a[0]]
      out.push(['L', [...cur]])
    } else if (lower === 'a') {
      const end = abs(a[5], a[6])
      out.push(['A', [a[0], a[1], a[2], a[3], a[4], ...end]])
      cur = end
    } else {
      const pts: number[] = []
      for (let k = 0; k < n; k += 2) pts.push(...abs(a[k], a[k + 1]))
      out.push([c.toUpperCase(), pts])
      cur = [pts[n - 2], pts[n - 1]]
    }
  }
  return out
}

const num = (x: number) => +x.toFixed(1)

/** The path with every point moved; arc radii follow the stretch at their end point. */
export function warpPath(d: string, w: Warp): string {
  return parsePath(d)
    .map(([c, a]) => {
      if (c === 'Z') return 'Z'
      if (c === 'A') {
        const end = w.at([a[5], a[6]])
        const [sx, sy] = w.scale([a[5], a[6]])
        return `A${num(a[0] * sx)} ${num(a[1] * sy)} ${a[2]} ${a[3]} ${a[4]} ${num(end[0])} ${num(end[1])}`
      }
      const pts: number[] = []
      for (let k = 0; k < a.length; k += 2) pts.push(...w.at([a[k], a[k + 1]]).map(num))
      return c + pts.join(' ')
    })
    .join('')
}

/** Where a figure's proportions are read from, in its drawing's coordinates. */
export interface Anchors {
  mid: number
  /** Top of the head (hair included), the chin, the crotch, the soles. */
  top: number
  chin: number
  crotch: number
  sole: number
  /** Shoulder width over head width in the drawing. */
  shoulders: number
}

/** Age groups the map draws; 'adult' is the drawing as it is. */
export const STAGES = ['adult', 'teen', 'child', 'young', 'toddler'] as const
export type Stage = (typeof STAGES)[number]

/** The youngest age in years of each group, oldest first. */
const FROM: Record<Stage, number> = { adult: 16, teen: 13, child: 9, young: 4, toddler: 0 }

export const stageOf = (age: number | null): Stage =>
  age === null ? 'adult' : (STAGES.find((s) => age >= FROM[s]) ?? 'toddler')

/**
 * Proportions by group, as shares of standing height: the head, and the legs from crotch to sole;
 * and shoulders over head width. Rounded from the usual drawing canons (a toddler is about four
 * and a half heads tall, an adult nearly eight).
 */
const SHAPE: Record<Exclude<Stage, 'adult'>, { head: number; legs: number; shoulders: number }> = {
  teen: { head: 0.14, legs: 0.53, shoulders: 2.4 },
  child: { head: 0.155, legs: 0.5, shoulders: 2.2 },
  young: { head: 0.18, legs: 0.46, shoulders: 2.0 },
  toddler: { head: 0.22, legs: 0.4, shoulders: 1.85 },
}

/**
 * The warp turning an adult drawing into a child of `stage`: the head scaled about the middle of
 * the chin; below it, heights stretched piecewise (neck and trunk to the crotch, legs to the
 * soles) and widths narrowed. The total height stays; the map fits the result in its box.
 * Points of the head (`head` true) move with the head, the rest with the body.
 */
export function childWarp(a: Anchors, stage: Exclude<Stage, 'adult'>): { head: Warp; body: Warp } {
  const shape = SHAPE[stage]
  const total = a.sole - a.top
  const headH = a.chin - a.top
  const sh = (shape.head * total) / headH
  const chin = a.top + shape.head * total
  const crotch = a.sole - shape.legs * total
  const trunk = (crotch - chin) / (a.crotch - a.chin)
  const legs = (a.sole - crotch) / (a.sole - a.crotch)
  const sx = (sh * shape.shoulders) / a.shoulders
  const head: Warp = {
    at: ([x, y]) => [a.mid + (x - a.mid) * sh, chin + (y - a.chin) * sh],
    scale: () => [sh, sh],
  }
  const sy = (y: number) => (y < a.crotch ? trunk : legs)
  const body: Warp = {
    at: ([x, y]) => [
      a.mid + (x - a.mid) * sx,
      y < a.crotch ? chin + (y - a.chin) * trunk : crotch + (y - a.crotch) * legs,
    ],
    scale: ([, y]) => [sx, sy(y)],
  }
  return { head, body }
}
