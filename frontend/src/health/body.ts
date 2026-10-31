import { BODY_PARTS, type BodySide, type HealthEntry } from '../types'

/**
 * The health log laid on a body: which part each entry names, and how many entries each part (and
 * each side of a paired part) has, for the body map's heat. The body part is free text, so a typed
 * 'Knee' counts as the suggested 'knees'.
 */

/** Paired parts: drawn once per side, and filterable by side. */
export const PAIRED: ReadonlySet<string> = new Set([
  'eyes',
  'ears',
  'lungs',
  'shoulders',
  'hips',
  'arms',
  'elbows',
  'wrists',
  'hands',
  'fingers',
  'legs',
  'knees',
  'ankles',
  'feet',
])

const KNOWN: ReadonlySet<string> = new Set(BODY_PARTS)
const SINGULAR: Record<string, string> = { foot: 'feet', tooth: 'mouth', teeth: 'mouth' }

/**
 * The body part an entry names, as one of `BODY_PARTS` when it is one (any case, singular or
 * plural: 'Knee' → 'knees'), else the text lower-cased and trimmed; '' for none.
 */
export function bodyKey(text: string): string {
  const k = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!k || KNOWN.has(k)) return k
  if (SINGULAR[k]) return SINGULAR[k]
  if (KNOWN.has(`${k}s`)) return `${k}s`
  return k
}

/**
 * Whether an entry on side `side` belongs to the body map's `want` side of its part: its own side,
 * both sides, or no side recorded (it is about the part as a whole).
 */
export const onSide = (side: BodySide, want: BodySide) =>
  !want || side === want || side === 'both' || side === ''

export interface BodyHeat {
  /** Entries per part, as `bodyKey` names it; parts with none are absent. */
  parts: Map<string, number>
  /** Of those, the ones on each side (`onSide`), for paired parts. */
  sides: Map<string, { left: number; right: number }>
  /** The largest count of any drawn part or side, the top of the colour scale (at least 1). */
  max: number
}

export function bodyHeat(entries: Pick<HealthEntry, 'bodyPart' | 'side'>[]): BodyHeat {
  const parts = new Map<string, number>()
  const sides = new Map<string, { left: number; right: number }>()
  for (const e of entries) {
    const k = bodyKey(e.bodyPart)
    if (!k) continue
    parts.set(k, (parts.get(k) ?? 0) + 1)
    if (!PAIRED.has(k)) continue
    const s = sides.get(k) ?? { left: 0, right: 0 }
    if (onSide(e.side, 'left')) s.left++
    if (onSide(e.side, 'right')) s.right++
    sides.set(k, s)
  }
  let max = 1
  for (const [k, n] of parts) {
    const s = sides.get(k)
    max = Math.max(max, s ? Math.max(s.left, s.right) : n)
  }
  return { parts, sides, max }
}

/** How many entries one region of the map stands for: the part, or one side of a paired part. */
export function regionCount(heat: BodyHeat, part: string, side: BodySide = ''): number {
  const s = heat.sides.get(part)
  if (side === 'left' || side === 'right') return s ? s[side] : 0
  return heat.parts.get(part) ?? 0
}

/** Steps of the colour scale; 0 is "none". */
export const HEAT_STEPS = 5

/** 0 for none, else 1–HEAT_STEPS in proportion to the busiest part. */
export const heatLevel = (n: number, max: number) =>
  n <= 0 ? 0 : Math.max(1, Math.ceil((n / Math.max(max, 1)) * HEAT_STEPS))
