import { PAIRED } from '../health/body'
import type { BodySide } from '../types'
import { FEMALE_BACK, FEMALE_FRONT, MALE_BACK, MALE_FRONT, type Outline } from './bodyOutline'

/**
 * The body map's figures: a drawn front and back body, male or female (bodyOutline.ts), whose
 * muscle groups are gathered into the parts of `BODY_PARTS`, and the parts the drawing has no
 * piece for (the face, the organs, the small joints) drawn over it as ovals.
 */

export type Figure = 'male' | 'female'
type View = 'front' | 'back'

export interface Piece {
  d: string
  /** Drawn over the body (an organ, a feature of the face) rather than as a piece of it. */
  overlay?: true
}

export interface Region {
  part: string
  side: BodySide
  view: View
  pieces: Piece[]
  /** Bounding box [x0, y0, x1, y1] in the scene, for zooming in. */
  box: number[]
}

/** The scene: the front figure in x 0–724, the back one in 724–1448, room for labels below. */
export const W = 1448
export const H = 1420
/** Each view's midline in the scene. */
export const MID = { front: 364, back: 1084 }

/** Muscle groups (the drawing's slugs) by the body part they stand for, per view. */
const PART_OF: Record<View, Record<string, string>> = {
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
 * Parts the drawing has no piece for, as ovals in the drawing's own coordinates on the viewer's
 * left half of a view (paired ones are mirrored) or on its midline.
 */
type Overlays = Partial<Record<View, Record<string, Oval>>>

const MALE_OVERLAYS: Overlays = {
  front: {
    ears: [311, 194, 7, 16],
    eyes: [344, 178, 12, 6],
    nose: [364, 202, 8, 14],
    mouth: [364, 230, 16, 6],
    throat: [364, 272, 12, 14],
    lungs: [318, 400, 38, 66],
    // The person's left, the viewer's right from the front.
    heart: [390, 410, 24, 28],
    stomach: [396, 478, 30, 22],
    elbows: [208, 500, 22, 16],
    wrists: [140, 690, 20, 10],
    fingers: [92, 790, 34, 24],
  },
  back: {
    ears: [1033, 194, 7, 16],
    elbows: [918, 528, 22, 16],
    wrists: [860, 690, 20, 10],
    fingers: [812, 790, 34, 24],
  },
}

const FEMALE_OVERLAYS: Overlays = {
  front: {
    ears: [254, 172, 7, 15],
    eyes: [302, 160, 11, 5],
    nose: [320.5, 182, 7, 12],
    mouth: [320.5, 210, 14, 5],
    throat: [320.5, 275, 10, 13],
    lungs: [278, 398, 32, 58],
    heart: [344, 408, 21, 25],
    stomach: [350, 470, 27, 19],
    elbows: [176, 482, 19, 13],
    wrists: [82, 652, 17, 9],
    fingers: [38, 740, 28, 22],
  },
  back: {
    elbows: [988, 490, 19, 13],
    wrists: [904, 648, 17, 9],
    fingers: [860, 740, 28, 22],
  },
}

/**
 * Where each drawing goes in the scene: scale `k` then shift by `dx`, `dy`, so both figures stand
 * on the same midlines and about the same height. `mid` is the drawing's own midline.
 */
interface Placement {
  outline: Outline[]
  overlays: Record<string, Oval>
  mid: number
  k: number
  dx: number
  dy: number
}

const FEMALE_K = 0.9
const PLACEMENTS: Record<Figure, Record<View, Placement>> = {
  male: {
    front: { outline: MALE_FRONT, overlays: MALE_OVERLAYS.front ?? {}, mid: 364, k: 1, dx: 0, dy: 0 },
    back: { outline: MALE_BACK, overlays: MALE_OVERLAYS.back ?? {}, mid: 1084, k: 1, dx: 0, dy: 0 },
  },
  female: {
    front: {
      outline: FEMALE_FRONT,
      overlays: FEMALE_OVERLAYS.front ?? {},
      mid: 320.5,
      k: FEMALE_K,
      dx: MID.front - 320.5 * FEMALE_K,
      dy: 60,
    },
    back: {
      outline: FEMALE_BACK,
      overlays: FEMALE_OVERLAYS.back ?? {},
      mid: 1142.5,
      k: FEMALE_K,
      dx: MID.back - 1142.5 * FEMALE_K,
      dy: 60,
    },
  },
}

/** The SVG transform that places a view's drawing in the scene. */
export const placement = (figure: Figure, view: View) => {
  const p = PLACEMENTS[figure][view]
  return `translate(${p.dx} ${p.dy}) scale(${p.k})`
}

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
const personSide = (view: View, side: Side): BodySide =>
  side === 'common' ? '' : view === 'back' ? side : side === 'left' ? 'right' : 'left'

/** A box in the drawing's coordinates, in the scene's. */
const place = (p: Placement, b: number[]) => [
  b[0] * p.k + p.dx,
  b[1] * p.k + p.dy,
  b[2] * p.k + p.dx,
  b[3] * p.k + p.dy,
]

function fromOutline(view: View, p: Placement): Region[] {
  const byKey = new Map<string, Region>()
  for (const o of p.outline) {
    const part = PART_OF[view][o.slug]
    if (!part) continue
    for (const side of ['common', 'left', 'right'] as Side[]) {
      const ds = o.paths[side]
      const box = o.box[side]
      if (!ds || !box) continue
      // A paired part keeps its sides apart; any other part is one region however it is drawn.
      const s = PAIRED.has(part) ? personSide(view, side) : ''
      const key = `${part}|${s}`
      const r = byKey.get(key) ?? { part, side: s, view, pieces: [], box: place(p, box) }
      r.pieces.push(...ds.map((d) => ({ d })))
      r.box = union([r.box, place(p, box)])
      byKey.set(key, r)
    }
  }
  return [...byKey.values()]
}

function overlays(view: View, p: Placement): Region[] {
  const out: Region[] = []
  for (const [part, [cx, cy, rx, ry]] of Object.entries(p.overlays)) {
    const region = (side: BodySide, x: number): Region => ({
      part,
      side,
      view,
      pieces: [{ d: oval(x, cy, rx, ry), overlay: true }],
      box: place(p, [x - rx, cy - ry, x + rx, cy + ry]),
    })
    if (!PAIRED.has(part)) out.push(region('', cx))
    else {
      out.push(region(personSide(view, 'left'), cx))
      out.push(region(personSide(view, 'right'), 2 * p.mid - cx))
    }
  }
  return out
}

/** Every region of a figure, per view: the drawing's pieces first, the overlays over them. */
export const REGIONS: Record<Figure, Region[]> = {
  male: [
    ...fromOutline('front', PLACEMENTS.male.front),
    ...overlays('front', PLACEMENTS.male.front),
    ...fromOutline('back', PLACEMENTS.male.back),
    ...overlays('back', PLACEMENTS.male.back),
  ],
  female: [
    ...fromOutline('front', PLACEMENTS.female.front),
    ...overlays('front', PLACEMENTS.female.front),
    ...fromOutline('back', PLACEMENTS.female.back),
    ...overlays('back', PLACEMENTS.female.back),
  ],
}
