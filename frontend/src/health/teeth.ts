/**
 * Teeth by their FDI (ISO 3950) number: the first digit is the quadrant, the second the tooth
 * counted from the midline. Quadrants 1–4 (upper right, upper left, lower left, lower right) hold
 * the 32 permanent teeth, 11–48; quadrants 5–8 the 20 milk (primary) teeth, 51–85. So a number
 * alone says whether a tooth is a milk tooth, and an export reads without the app.
 *
 * An entry stores its teeth as one detail, `teeth`: the numbers, ascending, space-separated
 * ("16 26 55").
 */

/** Upper then lower jaw, each from the person's right to their left (a dentist's view). */
const rows = (right: [number, number], left: [number, number], n: number) => [
  Array.from({ length: n }, (_, i) => right[0] * 10 + n - i).concat(
    Array.from({ length: n }, (_, i) => left[0] * 10 + i + 1),
  ),
  Array.from({ length: n }, (_, i) => right[1] * 10 + n - i).concat(
    Array.from({ length: n }, (_, i) => left[1] * 10 + i + 1),
  ),
]

/** [upper jaw, lower jaw], each person's right → left. */
export const PERMANENT_TEETH = rows([1, 4], [2, 3], 8)
export const MILK_TEETH = rows([5, 8], [6, 7], 5)

const ALL = new Set([...PERMANENT_TEETH.flat(), ...MILK_TEETH.flat()])

export const isMilkTooth = (n: number) => Math.floor(n / 10) >= 5

/** '26 16 x 16 99 55' → [16, 26, 55]: valid FDI numbers only, ascending, each once. */
export function parseTeeth(v: unknown): number[] {
  if (typeof v !== 'string') return []
  return [...new Set(v.split(/[\s,;]+/).map(Number))].filter((n) => ALL.has(n)).sort((a, b) => a - b)
}

/** Inverse of parseTeeth; undefined when there are none, so the detail is not stored. */
export const formatTeeth = (teeth: number[]): string | undefined =>
  teeth.length ? [...teeth].sort((a, b) => a - b).join(' ') : undefined

/** Adds the tooth, or takes it out when it is already there. */
export const toggleTooth = (teeth: number[], n: number) =>
  teeth.includes(n) ? teeth.filter((x) => x !== n) : [...teeth, n].sort((a, b) => a - b)

/** The teeth split into permanent and milk ones, each ascending. */
export function splitTeeth(v: unknown): { permanent: number[]; milk: number[] } {
  const all = parseTeeth(v)
  return { permanent: all.filter((n) => !isMilkTooth(n)), milk: all.filter(isMilkTooth) }
}

/** Plain English for the app's own text and for Ask: "teeth 16, 26 (FDI); milk teeth 55 (FDI)". */
export function describeTeeth(v: unknown): string {
  const { permanent, milk } = splitTeeth(v)
  return [
    permanent.length ? `teeth ${permanent.join(', ')} (FDI)` : '',
    milk.length ? `milk teeth ${milk.join(', ')} (FDI)` : '',
  ]
    .filter(Boolean)
    .join('; ')
}

/** What kind of tooth it is, for its tooltip: incisor, canine, premolar or molar. */
export function toothType(n: number): 'incisor' | 'canine' | 'premolar' | 'molar' {
  const i = n % 10
  if (i <= 2) return 'incisor'
  if (i === 3) return 'canine'
  return isMilkTooth(n) || i >= 6 ? 'molar' : 'premolar'
}
