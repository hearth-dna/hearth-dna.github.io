import type { HealthEntryInput } from '../db/repo'
import { findPreset, type HealthPreset, MEASUREMENT_PRESETS } from '../health/presets'
import type { Kb } from '../kb/kb'
import { labCatalogue, normaliseUnit, parseValue, recogniseAnalyte, toCanonical } from '../labs/normalise'
import type { HealthEntry } from '../types'
import { type DateFormat, guessDateFormat, parseDate, parseTime } from './dates'

/**
 * A CSV timeline (a spreadsheet of weights, a device export) → health-log entries for one person.
 * The user assigns every column; this module suggests the roles, converts every reading into the
 * app's unit for that metric, pairs blood pressure, and drops readings the log already has. Pure.
 */

/** What a column or a metric name becomes. */
export type Target =
  | { kind: 'preset'; preset: string; part?: 0 | 1 }
  | { kind: 'lab'; analyte: string }
  | { kind: 'custom'; title: string }

export interface MetricMap {
  target: Target
  /** The unit the file writes values in ('' = the metric's own unit). */
  unit: string
}

export type Role =
  | { role: 'date'; format: DateFormat }
  | { role: 'time' }
  | { role: 'note' }
  /** Wide files: this column is one metric. */
  | { role: 'metric'; metric: MetricMap }
  /** Long files: which metric, its value, its unit. */
  | { role: 'name' }
  | { role: 'value' }
  | { role: 'unit' }

/**
 * A column's role and whether it is imported at all. A skipped column keeps its role, so ticking
 * it again brings its mapping back.
 */
export type Column = Role & { skip: boolean }
/** A long file's metric name: what it is, and whether its readings are imported. */
export type NameMap = MetricMap & { skip: boolean }

export interface Mapping {
  shape: 'wide' | 'long'
  columns: Column[]
  /** Long files: each distinct metric name → what it is. */
  names: Record<string, NameMap>
  /** Set when the date column reads as both day-first and month-first. */
  ambiguousDate: boolean
}

export interface Table {
  header: string[]
  rows: string[][]
}

// ---- suggesting roles -----------------------------------------------------------------------

const DATE_HEADER =
  /^(date|day|datetime|date\/time|date time|timestamp|when|start ?date|creation ?date|дата|день|число)/i
const TIME_HEADER = /^(time|time of day|время)$/i
const NOTE_HEADER = /(note|comment|remark|заметк|коммент|примеч)/i
const NAME_HEADER =
  /^(type|metric|name|parameter|measurement|test|показател|параметр|тип|наименован|измерени)/i
const VALUE_HEADER = /^(value|result|reading|qty|quantity|amount|значени|результат|показани)/i
const UNIT_HEADER = /^(unit|units|uom|ед|единиц)/i

/** "Weight (lb)", "Weight [kg]", "Weight, kg" → name and unit. */
export function splitHeader(header: string): { name: string; unit: string } {
  const m = /^(.*?)\s*(?:\(([^)]*)\)|\[([^\]]*)\]|,\s*([^,]{1,12}))\s*$/.exec(header.trim())
  return m ? { name: m[1].trim(), unit: (m[2] ?? m[3] ?? m[4]).trim() } : { name: header.trim(), unit: '' }
}

const loose = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/μ/g, 'µ')
    .replace(/[\s_.]+/g, ' ')
    .trim()

/** Apple Health style identifiers ("HKQuantityTypeIdentifierBodyMass") → "body mass". */
const plainName = (s: string) =>
  loose(s.replace(/^HK(Quantity|Category)TypeIdentifier/, '').replace(/([a-z])([A-Z])/g, '$1 $2'))

const SYSTOLIC = /^(sys|systolic|систол|верхн)/i
const DIASTOLIC = /^(dia|diastolic|диастол|нижн)/i

/**
 * What a column header or a metric name is: a measurement preset by its title, UI name or
 * synonym (systolic and diastolic as the two halves of blood pressure), else a lab test by
 * name or abbreviation, else a custom metric under that name.
 */
export function suggestMetric(kb: Kb, raw: string, presetNames: (id: string) => string[]): MetricMap {
  const { name, unit } = splitHeader(raw)
  const n = plainName(name)
  if (SYSTOLIC.test(n)) return { target: { kind: 'preset', preset: 'blood-pressure', part: 0 }, unit }
  if (DIASTOLIC.test(n)) return { target: { kind: 'preset', preset: 'blood-pressure', part: 1 }, unit }
  const preset = MEASUREMENT_PRESETS.find((p) =>
    [p.title, ...presetNames(p.id), ...(p.synonyms ?? [])].some((x) => loose(x) === n),
  )
  if (preset && !preset.pair) return { target: { kind: 'preset', preset: preset.id }, unit }
  const lab = recogniseAnalyte(kb, name, normaliseUnit(kb, unit)).analyte
  if (lab) return { target: { kind: 'lab', analyte: lab }, unit }
  return { target: { kind: 'custom', title: name }, unit }
}

const numeric = (cells: string[]) => {
  const filled = cells.filter((c) => c.trim())
  return filled.length > 0 && filled.filter((c) => parseValue(c).value !== null).length >= filled.length * 0.8
}

/** A first mapping from the header and the cells; the user edits it before anything is saved. */
export function suggestMapping(kb: Kb, table: Table, presetNames: (id: string) => string[]): Mapping {
  const col = (i: number) => table.rows.map((r) => r[i] ?? '')
  const h = table.header.map((x) => x.trim())
  const long = h.some((x) => NAME_HEADER.test(x)) && h.some((x) => VALUE_HEADER.test(x))
  let ambiguousDate = false
  let haveDate = false
  const columns = h.map((header, i): Column => {
    const cells = col(i)
    const dateGuess = guessDateFormat(cells)
    if (
      !haveDate &&
      dateGuess &&
      (DATE_HEADER.test(header) || !numeric(cells) || dateGuess.format === 'ymd')
    ) {
      haveDate = true
      ambiguousDate = dateGuess.ambiguous
      return { role: 'date', format: dateGuess.format, skip: false }
    }
    if (TIME_HEADER.test(header)) return { role: 'time', skip: false }
    if (NOTE_HEADER.test(header)) return { role: 'note', skip: false }
    if (long && NAME_HEADER.test(header)) return { role: 'name', skip: false }
    if (long && VALUE_HEADER.test(header)) return { role: 'value', skip: false }
    if (long && UNIT_HEADER.test(header)) return { role: 'unit', skip: false }
    if (!long && numeric(cells))
      return { role: 'metric', metric: suggestMetric(kb, header, presetNames), skip: false }
    // Nothing to read here: left out, and a note if the user ticks it after all.
    return { role: 'note', skip: true }
  })
  const mapping: Mapping = { shape: long ? 'long' : 'wide', columns, names: {}, ambiguousDate }
  if (long) mapping.names = suggestNames(kb, table, mapping, presetNames)
  return mapping
}

/** The first ticked column with this role, or -1. */
export const columnOf = (columns: Column[], role: Role['role']) =>
  columns.findIndex((c) => c.role === role && !c.skip)

/** Long files: every distinct metric name, with its most common unit from the unit column. */
export function suggestNames(
  kb: Kb,
  table: Table,
  mapping: Pick<Mapping, 'columns'>,
  presetNames: (id: string) => string[],
): Record<string, NameMap> {
  const nameCol = columnOf(mapping.columns, 'name')
  const unitCol = columnOf(mapping.columns, 'unit')
  if (nameCol < 0) return {}
  const units = new Map<string, Map<string, number>>()
  for (const r of table.rows) {
    const n = r[nameCol]?.trim()
    if (!n) continue
    const u = unitCol >= 0 ? (r[unitCol]?.trim() ?? '') : ''
    const m = units.get(n) ?? new Map()
    m.set(u, (m.get(u) ?? 0) + 1)
    units.set(n, m)
  }
  const out: Record<string, NameMap> = {}
  for (const [n, us] of units) {
    const unit = [...us.entries()].sort((a, b) => b[1] - a[1])[0][0]
    out[n] = { ...suggestMetric(kb, n, presetNames), unit: unit || splitHeader(n).unit, skip: false }
  }
  return out
}

// ---- converting -----------------------------------------------------------------------------

/** How a metric's readings are stored: kind, title, unit, and the conversion from the file's unit. */
interface Sink {
  kind: 'measurement' | 'lab'
  title: string
  unit: string
  analyte: string
  preset?: HealthPreset
  part?: 0 | 1
  /** File value → stored value; null when the file's unit cannot be converted. */
  convert: ((v: number) => number) | null
  /** Digits kept after conversion. */
  decimals: number
}

const decimalsOf = (step = 0.1) => Math.max(0, -Math.floor(Math.log10(step)))

/** Where a metric's readings go, and whether the file's unit can be converted into the app's. */
export function sink(kb: Kb, m: MetricMap, labTitle: (analyte: string) => string): Sink {
  const unit = m.unit.trim()
  const t = m.target
  if (t.kind === 'preset') {
    const p = findPreset(t.preset) as HealthPreset
    const same = !unit || [p.unit ?? '', ...(p.unitAliases ?? [])].some((u) => loose(u) === loose(unit))
    const f = same ? (v: number) => v : (p.units?.[loose(unit)] ?? null)
    return {
      kind: 'measurement',
      title: p.title,
      unit: p.unit ?? '',
      analyte: '',
      preset: p,
      part: t.part,
      convert: f,
      decimals: decimalsOf(p.step) + 1,
    }
  }
  if (t.kind === 'lab') {
    const a = labCatalogue(kb).byId.get(t.analyte)
    if (!a) return { kind: 'lab', title: t.analyte, unit, analyte: '', convert: null, decimals: 2 }
    const from = unit ? normaliseUnit(kb, unit) : a.unit
    const f =
      from && toCanonical(a, 1, from) !== null ? (v: number) => toCanonical(a, v, from) as number : null
    return {
      kind: 'lab',
      title: labTitle(a.id),
      unit: a.unit,
      analyte: a.id,
      convert: f,
      decimals: a.decimals + 1,
    }
  }
  return { kind: 'measurement', title: t.title, unit, analyte: '', convert: (v) => v, decimals: 6 }
}

// ---- building entries -----------------------------------------------------------------------

export type SkipReason = 'noDate' | 'notNumber' | 'pairIncomplete' | 'duplicate'

export interface ImportResult {
  entries: HealthEntryInput[]
  skipped: { row: number; reason: SkipReason }[]
  /** Metrics whose file unit cannot be converted: a label and the unit, nothing of them is imported. */
  blocked: { label: string; unit: string }[]
  /** Wide files: entries each column adds (both halves of blood pressure count the pair). */
  perColumn: number[]
  /** Long files: entries each metric name adds. */
  perName: Record<string, number>
}

export const MAX_READINGS = 20_000

const round = (v: number, d: number) => Number(v.toFixed(d))
const dupKey = (e: Pick<HealthEntryInput, 'kind' | 'title' | 'date' | 'time' | 'value' | 'value2'>) =>
  [e.kind, e.title.toLowerCase(), e.date, e.time ?? '', e.value ?? '', e.value2 ?? ''].join('\u0000')

export function buildEntries(
  kb: Kb,
  table: Table,
  mapping: Mapping,
  o: { personId: string; source: string; existing: HealthEntry[]; labTitle: (analyte: string) => string },
): ImportResult {
  const dateCol = columnOf(mapping.columns, 'date')
  const dateRole = mapping.columns[dateCol] as Extract<Role, { role: 'date' }> | undefined
  const timeCol = columnOf(mapping.columns, 'time')
  const noteCols = mapping.columns.flatMap((c, i) => (c.role === 'note' && !c.skip ? [i] : []))
  const nameCol = columnOf(mapping.columns, 'name')
  const valueCol = columnOf(mapping.columns, 'value')
  const unitCol = columnOf(mapping.columns, 'unit')

  const sinks = new Map<string, Sink>()
  const sinkFor = (m: MetricMap) => {
    const k = JSON.stringify(m)
    if (!sinks.has(k)) sinks.set(k, sink(kb, m, o.labTitle))
    return sinks.get(k) as Sink
  }
  const blocked = new Map<string, { label: string; unit: string }>()
  const seen = new Set(o.existing.filter((e) => e.personId === o.personId).map(dupKey))
  const entries: HealthEntryInput[] = []
  /** The 1-based file row each entry came from, for the skip report. */
  const rowOf: number[] = []
  /** The columns (wide) or the metric name (long) each entry came from, for the per-column counts. */
  const fromOf: (number[] | string)[] = []
  const skipped: ImportResult['skipped'] = []

  table.rows.forEach((row, i) => {
    const when = dateRole ? parseDate(row[dateCol] ?? '', dateRole.format) : null
    if (!when) {
      if (row.some((c) => c.trim())) skipped.push({ row: i + 1, reason: 'noDate' })
      return
    }
    const time = (timeCol >= 0 ? parseTime(row[timeCol] ?? '') : '') || when.time
    const note = noteCols
      .map((c) => row[c]?.trim())
      .filter(Boolean)
      .join('; ')
    // The readings of this row: [metric, cell, the unit the file wrote, where it came from].
    type Cell = [MetricMap, string, string, number | string]
    const cells: Cell[] =
      mapping.shape === 'wide'
        ? mapping.columns.flatMap((c, j) =>
            c.role === 'metric' && !c.skip && row[j]?.trim()
              ? [[c.metric, row[j], c.metric.unit, j] as Cell]
              : [],
          )
        : (() => {
            const name = row[nameCol]?.trim() ?? ''
            const m = mapping.names[name]
            const cell = row[valueCol] ?? ''
            if (!m || m.skip || !cell.trim()) return []
            const unit = unitCol >= 0 && row[unitCol]?.trim() ? row[unitCol].trim() : m.unit
            return [[{ target: m.target, unit }, cell, unit, name] as Cell]
          })()
    const pairs = new Map<string, { sys?: number; dia?: number; from: number[] }>()
    for (const [m, cell, unit, from] of cells) {
      const s = sinkFor(m)
      const v = parseValue(cell)
      if (v.value === null) {
        skipped.push({ row: i + 1, reason: 'notNumber' })
        continue
      }
      if (!s.convert) {
        blocked.set(`${s.title}|${unit}`, { label: s.title, unit })
        continue
      }
      const value = round(s.convert(v.value), s.decimals)
      if (s.preset?.pair) {
        const p = pairs.get(s.title) ?? { from: [] }
        if (s.part === 1) p.dia = value
        else p.sys = value
        if (typeof from === 'number') p.from.push(from)
        pairs.set(s.title, p)
        continue
      }
      rowOf.push(i + 1)
      fromOf.push(typeof from === 'number' ? [from] : from)
      entries.push({
        personId: o.personId,
        date: when.date,
        time,
        kind: s.kind,
        title: s.title,
        body: note,
        source: o.source,
        value,
        unit: s.unit,
        analyte: s.analyte,
        valueText: v.comparator ? cell.trim() : '',
      })
    }
    for (const [title, p] of pairs) {
      if (p.sys === undefined || p.dia === undefined) {
        skipped.push({ row: i + 1, reason: 'pairIncomplete' })
        continue
      }
      rowOf.push(i + 1)
      fromOf.push(p.from)
      entries.push({
        personId: o.personId,
        date: when.date,
        time,
        kind: 'measurement',
        title,
        body: note,
        source: o.source,
        value: p.sys,
        value2: p.dia,
        unit: 'mmHg',
      })
    }
  })

  // Readings the log (or an earlier row of this file) already has are not added twice.
  const kept = entries.flatMap((e, n) => {
    const k = dupKey(e)
    if (seen.has(k)) {
      skipped.push({ row: rowOf[n], reason: 'duplicate' })
      return []
    }
    seen.add(k)
    return [{ e, from: fromOf[n] }]
  })
  const fresh = kept.slice(0, MAX_READINGS)
  const perColumn = mapping.columns.map(() => 0)
  const perName: Record<string, number> = {}
  for (const { from } of fresh) {
    if (typeof from === 'string') perName[from] = (perName[from] ?? 0) + 1
    else for (const j of new Set(from)) perColumn[j]++
  }
  return {
    entries: fresh.map((x) => x.e),
    skipped,
    blocked: [...blocked.values()],
    perColumn,
    perName,
  }
}
