import { PAIRED } from '../health/body'
import type { BodySide } from '../types'
import { FEMALE_BACK, FEMALE_FRONT, MALE_BACK, MALE_FRONT, type Outline } from './bodyOutline'
import { type Anchors, childWarp, type Stage, type Warp, warpPath } from './bodyWarp'

/**
 * The body map's figures: a drawn front and back body, male or female (bodyOutline.ts), whose
 * muscle groups are gathered into the parts of `BODY_PARTS`, and the parts the drawing has no
 * piece for (the face, the organs, the small joints) drawn over it as ovals. Children are the
 * adult drawings reshaped by age (bodyWarp.ts).
 */

export type Figure = 'male' | 'female'
export type { Stage }

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
    armpit: [254, 384, 10, 16],
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
    armpit: [224, 372, 9, 14],
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

/** One view of a drawing: its outline, overlays, and where its proportions are read from. */
interface Drawing {
  outline: Outline[]
  overlays: Record<string, Oval>
  anchors: Anchors
}

const MALE_Y = { top: 96, chin: 254, crotch: 660, sole: 1342, shoulders: 2.7 }
const FEMALE_Y = { top: 85, chin: 243, crotch: 620, sole: 1428, shoulders: 2.1 }
const DRAWINGS: Record<Figure, Record<View, Drawing>> = {
  male: {
    front: { outline: MALE_FRONT, overlays: MALE_OVERLAYS.front ?? {}, anchors: { mid: 364, ...MALE_Y } },
    back: { outline: MALE_BACK, overlays: MALE_OVERLAYS.back ?? {}, anchors: { mid: 1084, ...MALE_Y } },
  },
  female: {
    front: {
      outline: FEMALE_FRONT,
      overlays: FEMALE_OVERLAYS.front ?? {},
      anchors: { mid: 320.5, ...FEMALE_Y },
    },
    back: {
      outline: FEMALE_BACK,
      overlays: FEMALE_OVERLAYS.back ?? {},
      anchors: { mid: 1142.5, ...FEMALE_Y },
    },
  },
}

/** What moves with the head when a child's head is enlarged; the rest moves with the body. */
const HEAD = new Set(['head', 'hair', 'ears', 'eyes', 'nose', 'mouth'])

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

const IDENTITY: Warp = { at: (p) => p, scale: () => [1, 1] }
const warpBox = (w: Warp, b: number[]) => {
  const [x0, y0] = w.at([b[0], b[1]])
  const [x1, y1] = w.at([b[2], b[3]])
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]
}

/** A warp that fits box `from` onto box `to`. */
const boxWarp = (from: number[], to: number[]): Warp => {
  const sx = (to[2] - to[0]) / (from[2] - from[0])
  const sy = (to[3] - to[1]) / (from[3] - from[1])
  return { at: ([x, y]) => [to[0] + (x - from[0]) * sx, to[1] + (y - from[1]) * sy], scale: () => [sx, sy] }
}

/**
 * A girl younger than a teenager gets a flat chest: the male drawing's, fitted into the female
 * chest's place.
 */
function flatChest(o: Outline): Outline {
  const male = MALE_FRONT.find((m) => m.slug === 'chest')
  if (!male) return o
  const paths: Outline['paths'] = {}
  for (const side of ['left', 'right'] as const) {
    const from = male.box[side]
    const to = o.box[side]
    const ds = male.paths[side]
    if (from && to && ds) paths[side] = ds.map((d) => warpPath(d, boxWarp(from, to)))
  }
  return { ...o, paths }
}

/** One view's regions in the drawing's coordinates, reshaped for the age group. */
function draw(view: View, d: Drawing, figure: Figure, stage: Stage): Region[] {
  const warp = stage === 'adult' ? { head: IDENTITY, body: IDENTITY } : childWarp(d.anchors, stage)
  const flat = figure === 'female' && view === 'front' && stage !== 'adult' && stage !== 'teen'
  const byKey = new Map<string, Region>()
  for (const raw of d.outline) {
    const part = PART_OF[view][raw.slug]
    if (!part) continue
    const o = flat && raw.slug === 'chest' ? flatChest(raw) : raw
    const w = HEAD.has(raw.slug) ? warp.head : warp.body
    for (const side of ['common', 'left', 'right'] as Side[]) {
      const ds = o.paths[side]
      const box = o.box[side]
      if (!ds || !box) continue
      // A paired part keeps its sides apart; any other part is one region however it is drawn.
      const s = PAIRED.has(part) ? personSide(view, side) : ''
      const key = `${part}|${s}`
      const r = byKey.get(key) ?? { part, side: s, view, pieces: [], box: warpBox(w, box) }
      r.pieces.push(...ds.map((x) => ({ d: w === IDENTITY ? x : warpPath(x, w) })))
      r.box = union([r.box, warpBox(w, box)])
      byKey.set(key, r)
    }
  }
  const out = [...byKey.values()]
  for (const [part, [cx, cy, rx, ry]] of Object.entries(d.overlays)) {
    const w = HEAD.has(part) ? warp.head : warp.body
    const region = (side: BodySide, x: number): Region => {
      const [px, py] = w.at([x, cy])
      const [sx, sy] = w.scale([x, cy])
      return {
        part,
        side,
        view,
        pieces: [{ d: oval(px, py, rx * sx, ry * sy), overlay: true }],
        box: [px - rx * sx, py - ry * sy, px + rx * sx, py + ry * sy],
      }
    }
    if (!PAIRED.has(part)) out.push(region('', cx))
    else {
      out.push(region(personSide(view, 'left'), cx))
      out.push(region(personSide(view, 'right'), 2 * d.anchors.mid - cx))
    }
  }
  return out
}

/** How big a figure may be drawn: its half of the scene less a margin, and above the labels. */
const ROOM = { w: 660, h: 1290, sole: 1345 }

export interface Body {
  regions: Region[]
  /** The SVG transform placing each view's drawing in the scene. */
  transform: Record<View, string>
}

const built = new Map<string, Body>()

/**
 * A figure's regions with their boxes in the scene, and the transforms that place its drawings:
 * each view scaled to fit its half, on its midline, standing on the same ground. Built once.
 */
export function bodyOf(figure: Figure, stage: Stage): Body {
  const key = `${figure}|${stage}`
  const done = built.get(key)
  if (done) return done
  const regions: Region[] = []
  const transform = {} as Record<View, string>
  for (const view of ['front', 'back'] as const) {
    const d = DRAWINGS[figure][view]
    const rs = draw(view, d, figure, stage)
    const [x0, y0, x1, y1] = union(rs.map((r) => r.box))
    const k = Math.min(ROOM.w / (x1 - x0), ROOM.h / (y1 - y0))
    const dx = MID[view] - d.anchors.mid * k
    const dy = ROOM.sole - y1 * k
    transform[view] = `translate(${dx} ${dy}) scale(${k})`
    for (const r of rs)
      regions.push({
        ...r,
        box: [r.box[0] * k + dx, r.box[1] * k + dy, r.box[2] * k + dx, r.box[3] * k + dy],
      })
  }
  const body = { regions, transform }
  built.set(key, body)
  return body
}
