import type { Kb } from '../kb/kb'
import { tokens } from '../kb/text'
import type { KbAnalyte, LabIssue, LabRow, RawLabRow } from './types'

/**
 * Turns printed lab results into catalogue results: which test it is, the number, the unit, the
 * reference range and flag, and the value in the test's canonical unit. Pure and local; a model
 * only ever transcribes and suggests an id, every conversion happens here.
 */

/** Non-linear conversions into the canonical unit, by name (`KbAnalyte.convert`). */
export const CONVERSIONS: Record<string, Record<string, (v: number) => number>> = {
  // IFCC mmol/mol → NGSP %: % = mmol/mol / 10.929 + 2.15
  hba1c: { 'mmol/mol': (v) => v / 10.929 + 2.15 },
}

const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
}

/**
 * A printed unit as a lookup key: lower case, no spaces, one micro sign, no abbreviation dots
 * (фл., ед./л; the dot in 1.73 stays), and every spelling of a power of ten (×10⁹, x10E9, *10*9,
 * х10^9 with a Cyrillic х) as a bare 10^9.
 */
export function unitKey(printed: string): string {
  return printed
    .replace(/10([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, d: string) => `10^${[...d].map((c) => SUPERSCRIPT[c]).join('')}`)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[μ]/g, 'µ')
    .replace(/\s+/g, '')
    .replace(/\.(?!\d)/g, '')
    .replace(/^[x×х*·]?10(?:\^|\*\*?|e)(\d+)/, '10^$1')
}

/** SI prefixes as powers of ten, Latin and Cyrillic. */
const PREFIX: Record<string, number> = {
  '': 0,
  d: -1,
  д: -1,
  c: -2,
  m: -3,
  м: -3,
  µ: -6,
  u: -6,
  mc: -6,
  мк: -6,
  n: -9,
  н: -9,
  p: -12,
  п: -12,
  f: -15,
  ф: -15,
}
const BASE: Record<string, string> = { g: 'g', г: 'g', l: 'L', л: 'L', mol: 'mol', моль: 'mol' }
const PREFIXED = new RegExp(
  `^(${Object.keys(PREFIX)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .join('|')})?(${Object.keys(BASE).join('|')})$`,
)

/**
 * A unit key built from SI prefixes on grams, litres and moles ("нмоль/мл", "fl", "mcg/dl") as
 * its dimension and power of ten: "mol/L -6". Null for anything else.
 */
export function siSignature(key: string): string | null {
  const parts = key.split('/')
  if (parts.length > 2) return null
  const read = parts.map((p) => PREFIXED.exec(p))
  if (read.some((m) => !m)) return null
  const [num, den] = read as RegExpExecArray[]
  const exp = PREFIX[num[1] ?? ''] - (den ? PREFIX[den[1] ?? ''] : 0)
  return `${BASE[num[2]]}${den ? `/${BASE[den[2]]}` : ''} ${exp}`
}

/** A printed test name as a lookup key: lower case, brackets and punctuation as spaces. */
const nameKey = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()[\]{},.:;"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

interface Catalogue {
  byId: Map<string, KbAnalyte>
  byName: Map<string, string[]>
  /** Every name and synonym as tokens, for the fallback match. */
  phrases: { id: string; words: string[] }[]
  unitByAlias: Map<string, string>
  unitBySi: Map<string, string | null>
}

const cache = new WeakMap<Kb, Catalogue>()

export function labCatalogue(kb: Kb): Catalogue {
  const hit = cache.get(kb)
  if (hit) return hit
  const byName = new Map<string, string[]>()
  const phrases: Catalogue['phrases'] = []
  const add = (key: string, id: string) => {
    const k = nameKey(key)
    if (!k) return
    const ids = byName.get(k) ?? []
    if (!ids.includes(id)) byName.set(k, [...ids, id])
  }
  for (const a of kb.analytes) {
    const names = [...Object.values(a.names), ...Object.values(a.synonyms ?? {}).flat()]
    for (const n of [a.id, ...names, ...(a.abbreviations ?? [])]) add(n, a.id)
    for (const n of names) {
      const words = tokens(n)
      if (words.length) phrases.push({ id: a.id, words })
    }
  }
  const unitByAlias = new Map<string, string>()
  // Signature → unit, or null when two catalogue units share one (mg/L and µg/mL).
  const unitBySi = new Map<string, string | null>()
  for (const u of kb.units) {
    for (const key of [u.id, ...u.aliases].map(unitKey)) {
      unitByAlias.set(key, u.id)
      const sig = siSignature(key)
      if (sig) unitBySi.set(sig, unitBySi.has(sig) && unitBySi.get(sig) !== u.id ? null : u.id)
    }
  }
  const c = { byId: new Map(kb.analytes.map((a) => [a.id, a])), byName, phrases, unitByAlias, unitBySi }
  cache.set(kb, c)
  return c
}

/**
 * The canonical spelling of a printed unit, or '' when the catalogue does not know it. A spelling
 * not listed is still known when its SI prefixes make it exactly one catalogue unit: пмоль/мл is
 * nmol/L, мкг/л is ng/mL.
 */
export function normaliseUnit(kb: Kb, printed: string): string {
  if (!printed.trim()) return ''
  const c = labCatalogue(kb)
  const key = unitKey(printed)
  const sig = siSignature(key)
  return c.unitByAlias.get(key) ?? (sig && c.unitBySi.get(sig)) ?? ''
}

const COMPARATOR: Record<string, LabRow['comparator']> = {
  '<': '<',
  '>': '>',
  '<=': '<=',
  '>=': '>=',
  '≤': '<=',
  '≥': '>=',
}

/** A printed number: decimal comma or point, thousands spaces, a leading comparator. */
export function parseValue(printed: string): Pick<LabRow, 'value' | 'comparator' | 'text'> {
  const s = printed.trim().replace(/[−–]/g, '-')
  const m =
    /^(<=|>=|≤|≥|<|>)?\s*(-?\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)$/i.exec(s)
  if (!m) return { value: null, comparator: '', text: s }
  return {
    value: Number(m[2].replace(/[  ]/g, '').replace(',', '.')),
    comparator: COMPARATOR[m[1] ?? ''] ?? '',
    text: '',
  }
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const num = (s: string) => Number(s.replace(',', '.'))

/** A printed reference range: `3,9 - 6,1`, `3.9–6.1`, `<5.2`, `до 5,2`, `>1.0`, `M: 130-160`. */
export function parseRef(printed: string): { low: number | null; high: number | null } {
  const s = printed.toLowerCase().replace(/[–—−]/g, '-')
  const range = new RegExp(`${NUM}\\s*-\\s*${NUM}`).exec(s)
  if (range) return { low: num(range[1]), high: num(range[2]) }
  const upper = new RegExp(`(?:<=?|≤|до|up to|less than|below|менее)\\s*${NUM}`).exec(s)
  if (upper) return { low: null, high: num(upper[1]) }
  const lower = new RegExp(`(?:>=?|≥|от|more than|above|over|более)\\s*${NUM}`).exec(s)
  if (lower) return { low: num(lower[1]), high: null }
  return { low: null, high: null }
}

/**
 * Arrows drawn with a symbol font whose PDF has no Unicode map, so the text layer holds the
 * font's letter: Wingdings 3 draws ▲▼ as p q, Wingdings ⬆⬇ as é ê.
 */
const SYMBOL_ARROWS: Record<string, LabRow['flag']> = { p: 'H', q: 'L', é: 'H', ê: 'L' }

/** A printed flag: H/L, ↑/↓, ▲/▼, high/low, выше/ниже, a star. */
export function parseFlag(printed: string): LabRow['flag'] {
  const s = printed.trim().toLowerCase()
  if (!s) return ''
  if (printed.trim() in SYMBOL_ARROWS) return SYMBOL_ARROWS[printed.trim()]
  if (/^(h|hh|high|↑|▲|\*|\+|выше|повыш|в)/.test(s)) return 'H'
  if (/^(l|ll|low|↓|▼|ниже|пониж|н)/.test(s)) return 'L'
  return ''
}

const accepts = (a: KbAnalyte, unit: string) => unit === a.unit || unit in a.units

/** The value in the analyte's canonical unit, or null when there is no exact conversion. */
export function toCanonical(a: KbAnalyte, value: number, unit: string): number | null {
  if (unit === a.unit) return value
  const named = a.convert ? CONVERSIONS[a.convert]?.[unit] : undefined
  if (named) return named(value)
  const factor = a.units[unit]
  return typeof factor === 'number' ? value * factor : null
}

/**
 * Which catalogue test a printed name is. An exact name, synonym or abbreviation wins (also the
 * part outside or inside brackets: "Гемоглобин (HGB)"); then every word of a known name appearing
 * in it. Among several (Neutrophils % and absolute), the one whose units fit the printed unit.
 * The reader's own guess is only used when the name says nothing, and only if its unit fits.
 */
export function recogniseAnalyte(
  kb: Kb,
  printedName: string,
  unit: string,
  hint?: string,
): { analyte: string | null; issue?: LabIssue } {
  const cat = labCatalogue(kb)
  const outside = printedName.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  const inside = [...printedName.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map((m) => m[1] ?? m[2])
  let candidates: string[] = []
  for (const key of [printedName, outside, ...inside]) {
    candidates = cat.byName.get(nameKey(key)) ?? []
    if (candidates.length) break
  }
  const fits = (id: string) => !unit || accepts(cat.byId.get(id) as KbAnalyte, unit)
  if (!candidates.length) {
    const words = tokens(printedName)
    const found = cat.phrases.filter((p) => p.words.every((w) => words.includes(w)))
    const fitting = found.filter((p) => fits(p.id))
    const pool = fitting.length ? fitting : found
    const longest = Math.max(0, ...pool.map((p) => p.words.length))
    candidates = [...new Set(pool.filter((p) => p.words.length === longest).map((p) => p.id))]
  }
  if (candidates.length) {
    const fitting = candidates.filter(fits)
    const pool = fitting.length ? fitting : candidates
    const pick = hint && pool.includes(hint) ? hint : pool[0]
    return fitting.length ? { analyte: pick } : { analyte: pick, issue: 'unitMismatch' }
  }
  if (hint && cat.byId.has(hint))
    return fits(hint) ? { analyte: hint } : { analyte: hint, issue: 'unitMismatch' }
  return { analyte: null, issue: 'unknownAnalyte' }
}

/**
 * One printed result → a catalogue result with its issues for the review table. `pinned`: the
 * user chose the test by hand, so `raw.analyte` stands even when the name says otherwise.
 */
export function normaliseRow(kb: Kb, raw: RawLabRow, pinned = false): LabRow {
  const printedUnit = raw.unit?.trim() ?? ''
  const unit = normaliseUnit(kb, printedUnit)
  const issues: LabIssue[] = []
  if (printedUnit && !unit) issues.push('unknownUnit')
  const chosen = pinned && raw.analyte ? labCatalogue(kb).byId.get(raw.analyte) : undefined
  const { analyte, issue } = chosen
    ? { analyte: chosen.id, issue: unit && !accepts(chosen, unit) ? ('unitMismatch' as const) : undefined }
    : recogniseAnalyte(kb, raw.name, unit, raw.analyte)
  if (issue) issues.push(issue)
  const parsed = parseValue(raw.value)
  const { low, high } = parseRef(raw.ref ?? '')
  const a = analyte ? labCatalogue(kb).byId.get(analyte) : undefined
  // A unit-less result is read in the test's canonical unit (a TSH or an INR often prints none).
  const effective = unit || (a && !printedUnit ? a.unit : '')
  const value = a && parsed.value !== null && effective ? toCanonical(a, parsed.value, effective) : null
  const canonical = a && value !== null ? { value, unit: a.unit } : null
  if (a && canonical && (canonical.value < a.plausible[0] || canonical.value > a.plausible[1]))
    issues.push('implausible')
  let flag = parseFlag(raw.flag ?? '')
  if (!flag && parsed.value !== null && !parsed.comparator) {
    if (low !== null && parsed.value < low) flag = 'L'
    else if (high !== null && parsed.value > high) flag = 'H'
  }
  return {
    printedName: raw.name.trim(),
    printedValue: raw.value.trim(),
    printedUnit,
    printedRef: raw.ref?.trim() ?? '',
    printedFlag: raw.flag?.trim() ?? '',
    section: raw.section?.trim() ?? '',
    analyte,
    ...parsed,
    unit,
    refLow: low,
    refHigh: high,
    flag,
    canonical,
    issues,
  }
}
