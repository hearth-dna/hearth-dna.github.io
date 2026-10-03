import { MEASUREMENT_PRESETS, symptomPreset } from '../health/presets'
import type { Kb } from '../kb/kb'
import { labCatalogue, normaliseUnit, recogniseAnalyte, toCanonical } from '../labs/normalise'
import type { KbAnalyte } from '../labs/types'
import type { HealthEntry, Person } from '../types'
import { ageYears } from './reference'

/**
 * What the Charts page draws: every numeric health-log reading, grouped into metrics (one lab
 * test, one measurement preset, or one custom title and unit), converted into the metric's one
 * unit so a glucose in mg/dL and one in mmol/L sit on the same line. Pure.
 */

/** What a metric is, for its label: the UI resolves names through the catalogue or i18n. */
export type MetricSource =
  | { kind: 'lab'; analyte: string }
  | { kind: 'preset'; preset: string; part?: 0 | 1 }
  | { kind: 'custom'; title: string }
  /** A symptom's severity or one of its numeric details (Bristol type, times a day). */
  | { kind: 'symptom'; preset?: string; title: string; field: string }
  /** Worked out from other readings: BMI from a weight and the height at that time. */
  | { kind: 'derived'; id: 'bmi' }

export interface Metric {
  key: string
  source: MetricSource
  unit: string
  group: 'lab' | 'measurement' | 'symptom' | 'other'
  count: number
  personIds: string[]
}

export interface Point {
  /** ms since epoch, local time; noon when no time was recorded. */
  t: number
  value: number
  entry: HealthEntry
}

export interface Panel {
  key: string
  source: MetricSource
  unit: string
  /** The reference range every reading in the panel printed, when they all agree. */
  band: { low: number | null; high: number | null } | null
  series: { personId: string; points: Point[] }[]
}

interface Reading {
  key: string
  source: MetricSource
  unit: string
  group: Metric['group']
  value: number
  /** The printed range converted like the value; undefined when the reading is not a lab result. */
  ref?: { low: number | null; high: number | null }
  entry: HealthEntry
}

export const pointTime = (e: Pick<HealthEntry, 'date' | 'time'>) =>
  new Date(`${e.date}T${e.time || '12:00'}`).getTime()

const presetFor = (e: HealthEntry) =>
  MEASUREMENT_PRESETS.find((p) => p.title.toLowerCase() === e.title.trim().toLowerCase() && p.unit === e.unit)

/** A lab reading in its test's canonical unit, or in its own unit when there is no exact conversion. */
function labReading(kb: Kb, e: HealthEntry, value: number): Reading | null {
  const printed = normaliseUnit(kb, e.unit)
  const id = e.analyte || recogniseAnalyte(kb, e.title, printed).analyte
  const a: KbAnalyte | undefined = id ? labCatalogue(kb).byId.get(id) : undefined
  if (!a) return null
  const unit = printed || (e.unit ? '' : a.unit)
  const canonical = unit ? toCanonical(a, value, unit) : null
  const conv = (v: number | null) => (v === null ? null : canonical === null ? v : toCanonical(a, v, unit))
  const ref = { low: conv(e.refLow), high: conv(e.refHigh) }
  if (canonical !== null)
    return {
      key: `lab:${a.id}`,
      source: { kind: 'lab', analyte: a.id },
      unit: a.unit,
      group: 'lab',
      value: canonical,
      ref,
      entry: e,
    }
  return {
    key: `lab:${a.id}|${e.unit}`,
    source: { kind: 'lab', analyte: a.id },
    unit: e.unit,
    group: 'lab',
    value,
    ref,
    entry: e,
  }
}

/** Every chartable number in an entry: none, one, or two (a blood pressure pair). */
export function readings(kb: Kb, e: HealthEntry): Reading[] {
  if (e.kind === 'symptom') return symptomReadings(e)
  if (e.value === null || !Number.isFinite(e.value)) return []
  if (e.kind === 'lab') {
    const r = labReading(kb, e, e.value)
    if (r) return [r]
  }
  const preset = e.kind === 'measurement' ? presetFor(e) : undefined
  if (preset) {
    const one = (part: 0 | 1, value: number): Reading => ({
      key: preset.pair ? `m:${preset.id}:${part}` : `m:${preset.id}`,
      source: preset.pair
        ? { kind: 'preset', preset: preset.id, part }
        : { kind: 'preset', preset: preset.id },
      unit: e.unit,
      group: 'measurement',
      value,
      entry: e,
    })
    return preset.pair && e.value2 !== null ? [one(0, e.value), one(1, e.value2)] : [one(0, e.value)]
  }
  const title = e.title.trim()
  return [
    {
      key: `t:${title.toLowerCase()}|${e.unit}`,
      source: { kind: 'custom', title },
      unit: e.unit,
      group: e.kind === 'measurement' ? 'measurement' : e.kind === 'lab' ? 'lab' : 'other',
      value: e.value,
      entry: e,
    },
  ]
}

/** A symptom's chartable numbers: its severity, and its scale and count details. */
function symptomReadings(e: HealthEntry): Reading[] {
  const preset = symptomPreset(e.title)
  const id = preset?.id ?? e.title.trim().toLowerCase()
  const one = (field: string, value: number, unit: string): Reading => ({
    key: `s:${id}:${field}`,
    source: { kind: 'symptom', preset: preset?.id, title: e.title.trim(), field },
    unit,
    group: 'symptom',
    value,
    entry: e,
  })
  const out = e.severity === null ? [] : [one('severity', e.severity, '/10')]
  for (const f of preset?.details ?? []) {
    const v = e.details[f.id]
    if ((f.kind === 'scale' || f.kind === 'count') && typeof v === 'number') out.push(one(f.id, v, ''))
  }
  return out
}

const DAY = 86_400_000
/** A child's height is only trusted this far from the weighing when it cannot be interpolated. */
const CHILD_HEIGHT_DAYS = 90

/**
 * BMI for every weighing that has a height to go with it: interpolated between the person's
 * heights before and after, else the nearest height (within 90 days for a child; any for an
 * adult or someone whose age is unknown, whose height does not change). kg and cm only.
 */
export function bmiReadings(entries: HealthEntry[], persons: Person[]): Reading[] {
  const byPerson = new Map<string, { w: Point[]; h: Point[] }>()
  for (const e of entries) {
    if (e.kind !== 'measurement' || e.value === null || !(e.value > 0)) continue
    const id = presetFor(e)?.id
    const side = id === 'weight' && e.unit === 'kg' ? 'w' : id === 'height' && e.unit === 'cm' ? 'h' : null
    if (!side) continue
    const p = byPerson.get(e.personId) ?? { w: [], h: [] }
    p[side].push({ t: pointTime(e), value: e.value, entry: e })
    byPerson.set(e.personId, p)
  }
  const out: Reading[] = []
  for (const [personId, { w, h }] of byPerson) {
    if (!h.length) continue
    h.sort((a, b) => a.t - b.t)
    const person = persons.find((p) => p.id === personId)
    for (const wt of w) {
      const age = person ? ageYears(person, wt.t) : null
      const before = h.filter((x) => x.t <= wt.t).at(-1)
      const after = h.find((x) => x.t >= wt.t)
      let cm: number | undefined
      if (before && after)
        cm =
          after.t === before.t
            ? before.value
            : before.value + ((after.value - before.value) * (wt.t - before.t)) / (after.t - before.t)
      else {
        const near = (before ?? after) as Point
        if (age === null || age >= 20 || Math.abs(near.t - wt.t) <= CHILD_HEIGHT_DAYS * DAY) cm = near.value
      }
      if (!cm) continue
      out.push({
        key: 'd:bmi',
        source: { kind: 'derived', id: 'bmi' },
        unit: 'kg/m²',
        group: 'measurement',
        value: Number((wt.value / (cm / 100) ** 2).toFixed(1)),
        entry: wt.entry,
      })
    }
  }
  return out
}

/** Every reading the charts know: each entry's own, then the derived ones (BMI). */
const allReadings = (kb: Kb, entries: HealthEntry[], persons: Person[]) => [
  ...entries.flatMap((e) => readings(kb, e)),
  ...bmiReadings(entries, persons),
]

/** The metrics that have readings, most-recorded first. */
export function availableMetrics(kb: Kb, entries: HealthEntry[], persons: Person[] = []): Metric[] {
  const by = new Map<string, Metric>()
  for (const r of allReadings(kb, entries, persons)) {
    const m = by.get(r.key) ?? {
      key: r.key,
      source: r.source,
      unit: r.unit,
      group: r.group,
      count: 0,
      personIds: [],
    }
    m.count++
    if (!m.personIds.includes(r.entry.personId)) m.personIds.push(r.entry.personId)
    by.set(r.key, m)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * The range every lab reading printed, if they all printed the same one. Compared at the test's
 * own precision, so 70–110 mg/dL and 3.9–6.1 mmol/L count as the same glucose range.
 */
function commonBand(kb: Kb, rs: Reading[]): Panel['band'] {
  const a = rs[0].source.kind === 'lab' ? labCatalogue(kb).byId.get(rs[0].source.analyte) : undefined
  const round = (v: number | null) => (v === null ? null : Number(v.toFixed(a?.decimals ?? 2)))
  const refs = rs.map((r) => r.ref && { low: round(r.ref.low), high: round(r.ref.high) })
  const first = refs[0]
  if (!first || (first.low === null && first.high === null)) return null
  return refs.every((x) => x && x.low === first.low && x.high === first.high) ? first : null
}

/**
 * The panels for the chosen metrics and people, in the order chosen, points oldest first.
 * `from`/`to` are ms bounds (inclusive); null is open-ended.
 */
export function buildPanels(
  kb: Kb,
  entries: HealthEntry[],
  o: { metrics: string[]; people: string[]; from: number | null; to: number | null },
  persons: Person[] = [],
): Panel[] {
  const chosen = new Set(o.metrics)
  const people = new Set(o.people)
  const byKey = new Map<string, Reading[]>()
  // BMI pairs a weighing with heights outside the range too, so derive before cutting.
  const mine = entries.filter((e) => people.has(e.personId))
  for (const r of allReadings(kb, mine, persons)) {
    const t = pointTime(r.entry)
    if ((o.from !== null && t < o.from) || (o.to !== null && t > o.to)) continue
    if (chosen.has(r.key)) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r])
  }
  return o.metrics.flatMap((key) => {
    const rs = byKey.get(key)
    if (!rs?.length) return []
    const series = o.people
      .map((personId) => ({
        personId,
        points: rs
          .filter((r) => r.entry.personId === personId)
          .map((r) => ({ t: pointTime(r.entry), value: r.value, entry: r.entry }))
          .sort((a, b) => a.t - b.t),
      }))
      .filter((s) => s.points.length)
    return [{ key, source: rs[0].source, unit: rs[0].unit, band: commonBand(kb, rs), series }]
  })
}

/**
 * A person's colour slot (1–8): their place among everyone, by creation order, so the colour
 * never changes when others are hidden. Past eight, slots repeat and the legend and labels carry
 * identity.
 */
export function colourSlot(persons: Person[], personId: string): number {
  const i = persons.findIndex((p) => p.id === personId)
  return (Math.max(0, i) % 8) + 1
}

/** Round, readable axis ticks between lo and hi: 1, 2 or 5 × 10ⁿ steps, about `n` of them. */
export function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10]
    .map((m) => m * mag)
    .reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a))
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(Number(v.toPrecision(12)))
  return out
}
