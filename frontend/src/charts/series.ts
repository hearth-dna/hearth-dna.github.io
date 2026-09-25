import { MEASUREMENT_PRESETS } from '../health/presets'
import type { Kb } from '../kb/kb'
import { labCatalogue, normaliseUnit, recogniseAnalyte, toCanonical } from '../labs/normalise'
import type { KbAnalyte } from '../labs/types'
import type { HealthEntry, Person } from '../types'

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

export interface Metric {
  key: string
  source: MetricSource
  unit: string
  group: 'lab' | 'measurement' | 'other'
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

/** The metrics that have readings, most-recorded first. */
export function availableMetrics(kb: Kb, entries: HealthEntry[]): Metric[] {
  const by = new Map<string, Metric>()
  for (const e of entries)
    for (const r of readings(kb, e)) {
      const m = by.get(r.key) ?? {
        key: r.key,
        source: r.source,
        unit: r.unit,
        group: r.group,
        count: 0,
        personIds: [],
      }
      m.count++
      if (!m.personIds.includes(e.personId)) m.personIds.push(e.personId)
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
): Panel[] {
  const chosen = new Set(o.metrics)
  const people = new Set(o.people)
  const byKey = new Map<string, Reading[]>()
  for (const e of entries) {
    if (!people.has(e.personId)) continue
    const t = pointTime(e)
    if ((o.from !== null && t < o.from) || (o.to !== null && t > o.to)) continue
    for (const r of readings(kb, e)) if (chosen.has(r.key)) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r])
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
