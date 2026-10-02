import type { Kb, KbRange, LmsRows } from '../kb/kb'
import type { Person } from '../types'

/**
 * Reference values for the Charts page, in the chart's own coordinates (time, value) for one
 * person: the WHO growth curves for a child's weight, height, BMI and head circumference, and the
 * curated normal ranges for adult BMI and vital signs (kb/reviewed/ranges.json). Pure.
 */

const DAY = 86_400_000
const MONTH = 30.4375 * DAY
const YEAR = 365.25 * DAY

type Indicator = keyof Kb['growth']['indicators']
/** Which WHO indicator a chart metric is compared with. */
const GROWTH: Record<string, Indicator> = {
  'm:weight': 'wfa',
  'm:height': 'lhfa',
  'd:bmi': 'bfa',
  'm:head-circumference': 'hcfa',
}

/** The percentiles drawn, as normal quantiles: P3, P15, P50, P85, P97. */
const CURVES: [number, number][] = [
  [3, -1.880794],
  [15, -1.036433],
  [50, 0],
  [85, 1.036433],
  [97, 1.880794],
]

export type Pt = [number, number]

export interface Reference {
  /** Shaded areas, the first drawn lightest: P3–P97 then P15–P85, or one normal range. */
  bands: { lower: Pt[]; upper: Pt[]; labels?: [string, string] }[]
  /** Dashed lines: the median ("P50") or a threshold ("overweight"). */
  lines: { label: string; points: Pt[] }[]
  /** "WHO" for growth curves, else the range's own label ("fasting") or ''. */
  kind: 'growth' | 'range'
  label: string
}

/** Why a metric with a reference has none drawn for this person. */
export type Missing = 'birthDate' | 'sex'

const birth = (p: Person) => (p.birthDate ? new Date(`${p.birthDate}T00:00`).getTime() : null)

/** Age in years at `t`: exact from the birth date, else from the year (mid-year), else null. */
export function ageYears(p: Person, t: number): number | null {
  const b = birth(p)
  if (b !== null) return (t - b) / YEAR
  return p.birthYear ? (t - new Date(p.birthYear, 6, 1).getTime()) / YEAR : null
}

/** L, M, S at a fractional month, interpolated between the monthly rows; null outside them. */
function lmsAt(rows: LmsRows, month: number): [number, number, number] | null {
  if (month < 0 || month > rows.length - 1) return null
  const i = Math.min(rows.length - 2, Math.floor(month))
  const f = month - i
  const [, l0, m0, s0] = rows[i]
  const [, l1, m1, s1] = rows[i + 1]
  return [l0 + (l1 - l0) * f, m0 + (m1 - m0) * f, s0 + (s1 - s0) * f]
}

/** The value at normal quantile z (LMS method). */
export const lmsValue = ([l, m, s]: [number, number, number], z: number) =>
  l === 0 ? m * Math.exp(s * z) : m * (1 + l * s * z) ** (1 / l)

/** The normal quantile of value x. */
export const lmsZ = ([l, m, s]: [number, number, number], x: number) =>
  l === 0 ? Math.log(x / m) / s : ((x / m) ** l - 1) / (l * s)

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

const rowsFor = (kb: Kb, ind: Indicator, p: Person) =>
  p.sex === 'male'
    ? kb.growth.indicators[ind].boys
    : p.sex === 'female'
      ? kb.growth.indicators[ind].girls
      : null

/** The WHO percentile (0–100) of a child's reading, or null when there is no curve for it. */
export function percentileOf(kb: Kb, metric: string, p: Person, t: number, value: number): number | null {
  const ind = GROWTH[metric]
  const b = birth(p)
  const rows = ind && rowsFor(kb, ind, p)
  if (!rows || b === null || !(value > 0)) return null
  const lms = lmsAt(rows, (t - b) / MONTH)
  return lms ? phi(lmsZ(lms, value)) * 100 : null
}

/** Time samples across [from, to]: about one per month, never fewer than two. */
function samples(from: number, to: number): number[] {
  const n = Math.max(2, Math.min(240, Math.ceil((to - from) / MONTH) + 1))
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1))
}

function growth(kb: Kb, ind: Indicator, p: Person, [t0, t1]: [number, number]): Reference | null {
  const b = birth(p)
  const rows = rowsFor(kb, ind, p)
  if (b === null || !rows) return null
  const from = Math.max(t0, b)
  const to = Math.min(t1, b + (rows.length - 1) * MONTH)
  if (!(to > from)) return null
  const ts = samples(from, to)
  const curve = (z: number): Pt[] =>
    ts.map((t) => [t, lmsValue(lmsAt(rows, (t - b) / MONTH) as [number, number, number], z)])
  const [p3, p15, p50, p85, p97] = CURVES.map(([, z]) => curve(z))
  return {
    kind: 'growth',
    label: 'WHO',
    bands: [
      { lower: p3, upper: p97, labels: ['P3', 'P97'] },
      { lower: p15, upper: p85, labels: ['P15', 'P85'] },
    ],
    lines: [{ label: 'P50', points: p50 }],
  }
}

/**
 * The ranges that apply to this person across the domain, cut where an age band starts or ends.
 * Without any age, only adult ranges (no upper age) are drawn.
 */
function ranges(kb: Kb, metric: string, p: Person, [t0, t1]: [number, number]): Reference | null {
  const out: Reference = { kind: 'range', label: '', bands: [], lines: [] }
  const at = (years: number) => {
    const b = birth(p) ?? (p.birthYear ? new Date(p.birthYear, 6, 1).getTime() : null)
    return b === null ? null : b + years * YEAR
  }
  for (const r of kb.ranges.filter((x: KbRange) => x.metric === metric)) {
    let from = t0
    let to = t1
    if (ageYears(p, t0) === null) {
      if (r.age_max !== undefined) continue
    } else {
      if (r.age_min !== undefined) from = Math.max(from, at(r.age_min) as number)
      if (r.age_max !== undefined) to = Math.min(to, at(r.age_max) as number)
    }
    if (!(to > from)) continue
    const flat = (v: number): Pt[] => [
      [from, v],
      [to, v],
    ]
    out.bands.push({ lower: flat(r.normal[0]), upper: flat(r.normal[1]) })
    for (const l of r.lines ?? []) out.lines.push({ label: l.label, points: flat(l.value) })
    out.label ||= r.label ?? ''
  }
  return out.bands.length ? out : null
}

/** Whether a metric has any reference at all, so the page can say why one is not drawn. */
export const hasReference = (kb: Kb, metric: string) =>
  metric in GROWTH || kb.ranges.some((r) => r.metric === metric)

/**
 * The reference for one metric and person over the chart's time domain: the WHO curves while the
 * person is a child, the adult or age-banded range otherwise (BMI switches at 19). `missing` says
 * what the person needs before growth curves can be drawn.
 */
export function referenceFor(
  kb: Kb,
  metric: string,
  p: Person,
  domain: [number, number],
): { reference: Reference | null; missing: Missing | null } {
  const ind = GROWTH[metric]
  if (!ind) return { reference: ranges(kb, metric, p, domain), missing: null }
  const age = ageYears(p, domain[0])
  // A grown-up's weight or height has no curve; their BMI has the adult categories. With no age
  // at all, a metric that has an adult range gets it; one that has only curves asks for the date.
  const child = age === null ? !kb.ranges.some((r) => r.metric === metric) : age < 19
  if (!child) return { reference: ranges(kb, metric, p, domain), missing: null }
  if (!p.birthDate) return { reference: null, missing: 'birthDate' }
  if (p.sex === 'unknown') return { reference: null, missing: 'sex' }
  const g = growth(kb, ind, p, domain)
  const r = ranges(kb, metric, p, domain)
  if (!g) return { reference: r, missing: null }
  return {
    reference: r ? { ...g, bands: [...g.bands, ...r.bands], lines: [...g.lines, ...r.lines] } : g,
    missing: null,
  }
}
