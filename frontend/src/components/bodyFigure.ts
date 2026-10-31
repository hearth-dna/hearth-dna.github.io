import { PAIRED } from '../health/body'
import type { BodySide } from '../types'
import { BACK_OUTLINE, FRONT_OUTLINE, type Outline } from './bodyOutline'

/**
 * The body map's figure: a drawn front and back body (bodyOutline.ts) whose muscle groups are
 * gathered into the parts of `BODY_PARTS`, and the parts the drawing has no piece for (the face,
 * the organs, the small joints) drawn over it as ovals.
 */

export interface Piece {
  d: string
  /** Drawn over the body (an organ, a feature of the face) rather than as a piece of it. */
  overlay?: true
}

export interface Region {
  part: string
  side: BodySide
  view: 'front' | 'back'
  pieces: Piece[]
  /** Bounding box [x0, y0, x1, y1], for zooming in. */
  box: number[]
}

/** The scene: the front figure in x 0–724, the back one in 724–1448, room for labels below. */
export const W = 1448
export const H = 1420
/** Each figure's midline. */
export const MID = { front: 364, back: 1084 }

/** Muscle groups (the drawing's slugs) by the body part they stand for, per view. */
const PART_OF: Record<'front' | 'back', Record<string, string>> = {
  front: {
    hair: 'head',
    head: 'head',
    neck: 'neck',
    trapezius: 'shoulders',
    deltoids: 'shoulders',
    chest: 'chest',
    abs: 'abdomen',
    obliques: 'abdomen',
    biceps: 'arms',
    triceps: 'arms',
    forearm: 'arms',
    hands: 'hands',
    adductors: 'legs',
    quadriceps: 'legs',
    tibialis: 'legs',
    calves: 'legs',
    knees: 'knees',
    ankles: 'ankles',
    feet: 'feet',
  },
  back: {
    hair: 'head',
    head: 'head',
    neck: 'neck',
    deltoids: 'shoulders',
    trapezius: 'back',
    'upper-back': 'back',
    'lower-back': 'lower back',
    gluteal: 'hips',
    triceps: 'arms',
    forearm: 'arms',
    hands: 'hands',
    adductors: 'legs',
    hamstring: 'legs',
    calves: 'legs',
    ankles: 'ankles',
    feet: 'feet',
  },
}

/** An oval as path data. */
const oval = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`

type Oval = [number, number, number, number]

/**
 * Parts the drawing has no piece for, as ovals on the viewer's left half of the front figure
 * (paired ones are mirrored) or on the midline; those with `back` are on the back figure too.
 */
const OVERLAYS: { part: string; front: Oval; back?: Oval }[] = [
  { part: 'ears', front: [311, 194, 7, 16], back: [1033, 194, 7, 16] },
  { part: 'eyes', front: [344, 178, 12, 6] },
  { part: 'nose', front: [362, 202, 8, 14] },
  { part: 'mouth', front: [362, 230, 16, 6] },
  { part: 'throat', front: [362, 272, 12, 14] },
  { part: 'lungs', front: [318, 400, 38, 66] },
  // The person's left, the viewer's right from the front.
  { part: 'heart', front: [390, 410, 24, 28] },
  { part: 'stomach', front: [396, 478, 30, 22] },
  { part: 'elbows', front: [208, 500, 22, 16], back: [918, 528, 22, 16] },
  { part: 'wrists', front: [140, 690, 20, 10], back: [860, 690, 20, 10] },
  { part: 'fingers', front: [92, 790, 34, 24], back: [812, 790, 34, 24] },
]

type Side = 'common' | 'left' | 'right'

const union = (boxes: number[][]) => [
  Math.min(...boxes.map((b) => b[0])),
  Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])),
  Math.max(...boxes.map((b) => b[3])),
]

/**
 * Front: the person faces the viewer, so the drawing's left (the viewer's) is their right. Back:
 * seen from behind, the drawing's left is their left.
 */
const personSide = (view: 'front' | 'back', side: Side): BodySide =>
  side === 'common' ? '' : view === 'back' ? side : side === 'left' ? 'right' : 'left'

function fromOutline(view: 'front' | 'back', outline: Outline[]): Region[] {
  const byKey = new Map<string, Region>()
  for (const o of outline) {
    const part = PART_OF[view][o.slug]
    if (!part) continue
    for (const side of ['common', 'left', 'right'] as Side[]) {
      const ds = o.paths[side]
      const box = o.box[side]
      if (!ds || !box) continue
      // A paired part keeps its sides apart; any other part is one region however it is drawn.
      const s = PAIRED.has(part) ? personSide(view, side) : ''
      const key = `${part}|${s}`
      const r = byKey.get(key) ?? { part, side: s, view, pieces: [], box }
      r.pieces.push(...ds.map((d) => ({ d })))
      r.box = union([r.box, box])
      byKey.set(key, r)
    }
  }
  return [...byKey.values()]
}

function overlays(view: 'front' | 'back'): Region[] {
  const out: Region[] = []
  for (const o of OVERLAYS) {
    const at = view === 'front' ? o.front : o.back
    if (!at) continue
    const [cx, cy, rx, ry] = at
    const region = (side: BodySide, x: number): Region => ({
      part: o.part,
      side,
      view,
      pieces: [{ d: oval(x, cy, rx, ry), overlay: true }],
      box: [x - rx, cy - ry, x + rx, cy + ry],
    })
    if (!PAIRED.has(o.part)) out.push(region('', cx))
    else {
      out.push(region(personSide(view, 'left'), cx))
      out.push(region(personSide(view, 'right'), 2 * MID[view] - cx))
    }
  }
  return out
}

/** Every region, the drawing's pieces first and the overlays over them. */
export const REGIONS: Region[] = [
  ...fromOutline('front', FRONT_OUTLINE),
  ...fromOutline('back', BACK_OUTLINE),
  ...overlays('front'),
  ...overlays('back'),
]
