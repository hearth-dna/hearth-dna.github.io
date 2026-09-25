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

/** A printed unit as a lookup key: lower case, no spaces, one micro sign, 10⁹ → 10^9. */
export function unitKey(printed: string): string {
  return printed
    .replace(/10([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, d: string) => `10^${[...d].map((c) => SUPERSCRIPT[c]).join('')}`)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[μ]/g, 'µ')
    .replace(/×/g, 'x')
    .replace(/\s+/g, '')
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
  for (const u of kb.units) {
    unitByAlias.set(unitKey(u.id), u.id)
    for (const alias of u.aliases) unitByAlias.set(unitKey(alias), u.id)
  }
  const c = { byId: new Map(kb.analytes.map((a) => [a.id, a])), byName, phrases, unitByAlias }
  cache.set(kb, c)
  return c
}

/** The canonical spelling of a printed unit, or '' when the catalogue does not know it. */
export const normaliseUnit = (kb: Kb, printed: string): string =>
  printed.trim() ? (labCatalogue(kb).unitByAlias.get(unitKey(printed)) ?? '') : ''

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

/** A printed flag: H/L, ↑/↓, high/low, выше/ниже, a star. */
export function parseFlag(printed: string): LabRow['flag'] {
  const s = printed.trim().toLowerCase()
  if (!s) return ''
  if (/^(h|hh|high|↑|\*|\+|выше|повыш|в)/.test(s)) return 'H'
  if (/^(l|ll|low|↓|ниже|пониж|н)/.test(s)) return 'L'
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
