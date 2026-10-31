import { PAIRED } from '../health/body'
import type { BodySide } from '../types'

/**
 * The body map's figure: a front and a back silhouette cut into the parts of `BODY_PARTS`. Limbs are
 * tapered segments that meet at the joints with the same width, so the outline runs on unbroken;
 * the torso is curved by hand. Organs and the face are drawn over the silhouette as outlines.
 */

type P = [number, number]
type Cmd = ['M' | 'L', P] | ['Q', P, P] | ['C', P, P, P] | ['Z']

export interface Shape {
  cmds: Cmd[]
  /** Drawn over the silhouette (an organ, a feature of the face) rather than as a piece of it. */
  overlay?: true
}

export interface Region {
  part: string
  side: BodySide
  view: 'front' | 'back'
  shapes: Shape[]
}

/** One figure's box; the back figure sits to the right of the front one. */
export const FW = 200
const GAP = 30
export const W = FW * 2 + GAP
export const H = 440

const M = (p: P): Cmd => ['M', p]
const L = (p: P): Cmd => ['L', p]
const C = (a: P, b: P, p: P): Cmd => ['C', a, b, p]
const Q = (a: P, p: P): Cmd => ['Q', a, p]
const Z: Cmd = ['Z']

const shape = (...cmds: Cmd[]): Shape => ({ cmds })
const overlay = (...cmds: Cmd[]): Shape => ({ cmds, overlay: true })

/**
 * A limb segment from `a` (width `aw`) to `b` (width `bw`), its sides swelling by `bulge` (a calf,
 * a biceps); `round` closes the far end in a curve (fingertips, toes).
 */
function seg(a: P, aw: number, b: P, bw: number, bulge = 0, round = false): Shape {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const d: P = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
  const n: P = [-d[1], d[0]]
  const at = (p: P, k: number, along = 0): P => [
    p[0] + n[0] * k + d[0] * along,
    p[1] + n[1] * k + d[1] * along,
  ]
  const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const swell = (aw + bw) / 4 + bulge
  const end = round
    ? C(at(b, bw / 2, bw * 0.55), at(b, -bw / 2, bw * 0.55), at(b, -bw / 2))
    : L(at(b, -bw / 2))
  return shape(M(at(a, aw / 2)), Q(at(mid, swell), at(b, bw / 2)), end, Q(at(mid, -swell), at(a, -aw / 2)), Z)
}

/** The viewer's-left half of the front figure, or whole parts on the midline, in drawing order. */
const FRONT: [string, Shape[]][] = [
  // Limbs first, so the torso's edge lies over their tops.
  ['arms', [seg([63, 112], 18, [57, 160], 15, 2), seg([55, 174], 14, [50, 220], 10, 1.5)]],
  ['elbows', [seg([57, 160], 15, [55, 174], 14)]],
  ['wrists', [seg([50, 220], 10, [49, 228], 11)]],
  ['hands', [seg([49, 228], 11, [48, 246], 16, 1)]],
  ['fingers', [seg([48, 246], 16, [47, 264], 12, 0, true)]],
  ['legs', [seg([87, 232], 28, [89, 300], 20, 3), seg([89, 324], 18, [90, 386], 11, 3)]],
  ['knees', [seg([89, 300], 20, [89, 324], 18, 1)]],
  ['ankles', [seg([90, 386], 11, [90, 396], 11)]],
  ['feet', [seg([90, 396], 12, [87, 416], 20, 0, true)]],
  [
    'hips',
    [
      shape(
        M([73, 202]),
        L([100, 202]),
        L([100, 238]),
        C([92, 233], [80, 232], [73, 232]),
        C([72, 222], [72, 212], [73, 202]),
        Z,
      ),
    ],
  ],
  [
    'abdomen',
    [
      shape(
        M([77, 150]),
        C([78, 160], [79, 166], [79, 172]),
        C([77, 184], [74, 194], [73, 202]),
        L([127, 202]),
        C([126, 194], [123, 184], [121, 172]),
        C([121, 166], [122, 160], [123, 150]),
        Z,
      ),
    ],
  ],
  [
    'chest',
    [
      shape(
        M([91, 87]),
        C([84, 89], [78, 97], [76, 106]),
        L([74, 116]),
        C([75, 128], [76, 140], [77, 150]),
        L([123, 150]),
        C([124, 140], [125, 128], [126, 116]),
        L([124, 106]),
        C([122, 97], [116, 89], [109, 87]),
        C([104, 90], [96, 90], [91, 87]),
        Z,
      ),
    ],
  ],
  [
    'shoulders',
    [
      shape(
        M([91, 84]),
        C([78, 84], [64, 86], [57, 96]),
        C([53, 103], [53, 109], [54, 113]),
        L([72, 113]),
        L([76, 106]),
        C([78, 97], [84, 89], [91, 87]),
        Z,
      ),
    ],
  ],
  [
    'neck',
    [
      shape(
        M([90, 60]),
        L([110, 60]),
        C([110, 72], [111, 79], [112, 85]),
        C([106, 88], [94, 88], [88, 85]),
        C([89, 79], [90, 72], [90, 60]),
        Z,
      ),
    ],
  ],
  ['ears', [shape(M([76, 33]), C([68, 30], [66, 46], [71, 52]), C([73, 55], [76, 53], [77, 50]), Z)]],
  [
    'head',
    [
      shape(
        M([100, 8]),
        C([124, 8], [128, 30], [126, 42]),
        C([124, 56], [114, 66], [100, 67]),
        C([86, 66], [76, 56], [74, 42]),
        C([72, 30], [76, 8], [100, 8]),
        Z,
      ),
    ],
  ],
  [
    'throat',
    [
      overlay(
        M([100, 70]),
        C([104, 70], [105, 73], [105, 76]),
        C([105, 80], [103, 83], [100, 83]),
        C([97, 83], [95, 80], [95, 76]),
        C([95, 73], [96, 70], [100, 70]),
        Z,
      ),
    ],
  ],
  ['eyes', [overlay(M([84, 36]), Q([90, 31], [96, 36]), Q([90, 40], [84, 36]), Z)]],
  [
    'nose',
    [
      overlay(
        M([100, 38]),
        C([98, 44], [96, 48], [97, 50]),
        C([99, 51], [101, 51], [103, 50]),
        C([104, 48], [102, 44], [100, 38]),
        Z,
      ),
    ],
  ],
  ['mouth', [overlay(M([92, 56]), Q([100, 59], [108, 56]), Q([100, 63], [92, 56]), Z)]],
  [
    'lungs',
    [
      overlay(
        M([90, 98]),
        C([84, 100], [80, 112], [80, 128]),
        C([80, 138], [84, 143], [92, 140]),
        C([95, 130], [95, 108], [90, 98]),
        Z,
      ),
    ],
  ],
  // The person's left, so the viewer's right from the front.
  [
    'heart',
    [
      overlay(
        M([104, 118]),
        C([108, 112], [117, 114], [116, 122]),
        C([115, 129], [109, 134], [105, 138]),
        C([101, 132], [98, 126], [100, 120]),
        C([101, 117], [103, 117], [104, 118]),
        Z,
      ),
    ],
  ],
  [
    'stomach',
    [
      overlay(
        M([101, 155]),
        C([109, 150], [120, 154], [119, 163]),
        C([118, 171], [110, 175], [104, 171]),
        C([100, 168], [104, 162], [101, 155]),
        Z,
      ),
    ],
  ],
]

/** From behind: the same limbs, head and hips; the upper and lower back in place of chest and belly. */
const BACK_TORSO: [string, Shape[]][] = [
  [
    'back',
    [
      shape(
        M([91, 87]),
        C([84, 89], [78, 97], [76, 106]),
        L([74, 116]),
        C([75, 132], [77, 150], [79, 166]),
        L([121, 166]),
        C([123, 150], [125, 132], [126, 116]),
        L([124, 106]),
        C([122, 97], [116, 89], [109, 87]),
        C([104, 90], [96, 90], [91, 87]),
        Z,
      ),
    ],
  ],
  [
    'lower back',
    [
      shape(
        M([79, 166]),
        C([79, 174], [76, 190], [73, 202]),
        L([127, 202]),
        C([124, 190], [121, 174], [121, 166]),
        Z,
      ),
    ],
  ],
]

const FRONT_ONLY = new Set([
  'chest',
  'abdomen',
  'throat',
  'eyes',
  'nose',
  'mouth',
  'lungs',
  'heart',
  'stomach',
])
const BACK_PARTS: [string, Shape[]][] = [
  ...FRONT.filter(
    ([p]) => !FRONT_ONLY.has(p) && p !== 'shoulders' && p !== 'neck' && p !== 'ears' && p !== 'head',
  ),
  ...BACK_TORSO,
  ...FRONT.filter(([p]) => p === 'shoulders' || p === 'neck' || p === 'ears' || p === 'head'),
]

const mapPoints = (s: Shape, f: (p: P) => P): Shape => ({
  ...s,
  cmds: s.cmds.map((c) => [c[0], ...(c.slice(1) as P[]).map(f)] as Cmd),
})
const mirror = (s: Shape) => mapPoints(s, ([x, y]) => [FW - x, y])

/**
 * Front: the person faces the viewer, so their right is on the viewer's left. Back: seen from
 * behind, their right is on the viewer's right. Within a view, parts are drawn in list order.
 */
export const REGIONS: Region[] = (['front', 'back'] as const).flatMap((view) =>
  (view === 'front' ? FRONT : BACK_PARTS).flatMap(([part, shapes]): Region[] => {
    const place = (ss: Shape[]) =>
      view === 'back' ? ss.map((s) => mapPoints(s, ([x, y]) => [x + FW + GAP, y])) : ss
    if (!PAIRED.has(part)) return [{ part, side: '', view, shapes: place(shapes) }]
    const near: BodySide = view === 'front' ? 'right' : 'left'
    const far: BodySide = view === 'front' ? 'left' : 'right'
    return [
      { part, side: near, view, shapes: place(shapes) },
      { part, side: far, view, shapes: place(shapes.map(mirror)) },
    ]
  }),
)

/** SVG path data. */
export const pathOf = (s: Shape) =>
  s.cmds
    .map((c) => c[0] + (c.slice(1) as P[]).map((p) => `${+p[0].toFixed(1)} ${+p[1].toFixed(1)}`).join(' '))
    .join('')

export function bbox(shapes: Shape[]) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const s of shapes)
    for (const c of s.cmds)
      for (const [x, y] of c.slice(1) as P[]) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
  return { x0, y0, x1, y1 }
}
