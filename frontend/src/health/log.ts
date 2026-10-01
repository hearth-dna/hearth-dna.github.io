import { HEALTH_KIND_LABELS, type HealthEntry, type HealthKind } from '../types'
import { type DetailValue, symptomPreset } from './presets'

/** Pure helpers for the health log: tag encoding, one-line descriptions and filtering. */

/** 'Arthritis, flare ,,Flare' → ['arthritis', 'flare']: lower-case, trimmed, de-duplicated, in order. */
export function parseTags(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(',')) {
    const t = raw.trim().toLowerCase()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** Inverse of parseTags; what the `tags` column stores. */
export function formatTags(tags: string[]): string {
  return tags.join(', ')
}

/** The `details` column → an object; anything unreadable is treated as no details. */
export function parseDetails(text: string): Record<string, DetailValue> {
  if (!text) return {}
  try {
    const v = JSON.parse(text) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(
      Object.entries(v).filter(
        ([, x]) =>
          x === true || (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && x !== ''),
      ),
    ) as Record<string, DetailValue>
  } catch {
    return {}
  }
}

/** Inverse of parseDetails; '' when there are none, so the column stays empty. */
export const formatDetailsJson = (d: Record<string, DetailValue>) =>
  Object.keys(d).length ? JSON.stringify(d) : ''

/** For exports: `bristol=6; colour=yellow; blood`. */
export const detailsCell = (d: Record<string, DetailValue>) =>
  Object.entries(d)
    .map(([k, v]) => (v === true ? k : `${k}=${v}`))
    .join('; ')

/**
 * Details in plain English, in the preset's field order: "Bristol type 6, yellow, blood". Used
 * where the app writes text for itself and for Ask (the UI shows translated labels instead).
 */
export function formatDetails(e: Pick<HealthEntry, 'title' | 'details'>): string {
  const d = e.details ?? {}
  const fields = symptomPreset(e.title)?.details ?? []
  const order = [...fields.map((f) => f.id), ...Object.keys(d).filter((k) => !fields.some((f) => f.id === k))]
  return order
    .filter((k) => d[k] !== undefined)
    .map((k) => {
      const v = d[k]
      if (k === 'bristol') return `Bristol type ${v}`
      if (k === 'times') return `${v}× a day`
      return v === true ? k : `${k} ${v}`
    })
    .join(', ')
}

/** '8:05' → '08:05'; anything that is not a valid 24-hour HH:MM (or H:MM) becomes ''. */
export function normTime(s: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s.trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return ''
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/** The YYYY-MM-DD `days` calendar days before `date`. */
export function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** '2026-09-14 08:05', or just the date when no time was recorded. */
export const when = (e: Pick<HealthEntry, 'date' | 'time'>) => (e.time ? `${e.date} ${e.time}` : e.date)

/** '37.8 °C', '120/80 mmHg', '72' (no unit); '' when the entry has no value. */
export function formatValue(
  e: Pick<HealthEntry, 'value' | 'value2' | 'unit'> & { valueText?: string },
): string {
  if (e.value === null && !e.valueText) return ''
  const n = e.valueText || (e.value2 === null ? String(e.value) : `${e.value}/${e.value2}`)
  return e.unit ? `${n} ${e.unit}` : n
}

/** Body part with its side: `knees`, `knees, left`, `knees, both sides`. */
export function where(e: Pick<HealthEntry, 'bodyPart' | 'side'>): string {
  if (!e.bodyPart || !e.side) return e.bodyPart
  return `${e.bodyPart}, ${e.side === 'both' ? 'both sides' : e.side}`
}

/**
 * The entry on one line, as shown in the log and in the Ask context pack:
 * `2026-09-14 · Symptom · Pain in both hands (hands; severity 6/10; arthritis)`,
 * `2026-09-14 08:05 · Measurement · Blood pressure 120/80 mmHg`.
 *
 * This line is what the Ask context pack sends to a model, so it must never grow to mention an
 * entry's attachments: a file name like `biopsy-2026.pdf` would leave the device with it.
 */
export function describeEntry(e: HealthEntry): string {
  const value = formatValue(e)
  const extra = [
    formatDetails(e),
    where(e),
    e.severity === null ? '' : `severity ${e.severity}/10`,
    formatTags(e.tags),
  ].filter(Boolean)
  return `${when(e)} · ${HEALTH_KIND_LABELS[e.kind]} · ${e.title}${value ? ` ${value}` : ''}${extra.length ? ` (${extra.join('; ')})` : ''}`
}

export interface HealthFilter {
  /** Person id; '' for everyone. */
  person: string
  kind: HealthKind | ''
  bodyPart: string
  tag: string
  /** A condition id the entry is linked to. */
  condition: string
  /** Inclusive YYYY-MM-DD bounds; '' for open-ended. */
  from: string
  to: string
  /** Only entries rated at least this much; null for any (including unrated). */
  minSeverity: number | null
  /** Case-insensitive substring of title, body, body part, unit or tags. */
  text: string
}

export const NO_FILTER: HealthFilter = {
  person: '',
  kind: '',
  bodyPart: '',
  tag: '',
  condition: '',
  from: '',
  to: '',
  minSeverity: null,
  text: '',
}

export function isFiltering(f: HealthFilter): boolean {
  return Object.values(f).some((v) => v !== '' && v !== null)
}

/** Filters set in the Filters panel (not the kind chips or the search box); the count on its button. */
export function panelFilterCount(f: HealthFilter): number {
  return [f.person, f.bodyPart, f.tag, f.condition, f.from || f.to, f.minSeverity !== null].filter(Boolean)
    .length
}

export function filterHealthLog(entries: HealthEntry[], f: HealthFilter): HealthEntry[] {
  const q = f.text.trim().toLowerCase()
  return entries.filter(
    (e) =>
      (!f.person || e.personId === f.person) &&
      (!f.kind || e.kind === f.kind) &&
      (!f.bodyPart || e.bodyPart === f.bodyPart) &&
      (!f.tag || e.tags.includes(f.tag)) &&
      (!f.condition || e.conditions.includes(f.condition)) &&
      (!f.from || e.date >= f.from) &&
      (!f.to || e.date <= f.to) &&
      (f.minSeverity === null || (e.severity !== null && e.severity >= f.minSeverity)) &&
      (!q ||
        [e.title, e.body, e.bodyPart, e.unit, formatDetails(e), ...e.tags].some((s) =>
          s.toLowerCase().includes(q),
        )),
  )
}

export type HealthSortKey = 'date' | 'person' | 'kind' | 'title' | 'value' | 'bodyPart' | 'severity'
export type SortDir = 'asc' | 'desc'

/** Direction a column starts in when first clicked: newest, highest and worst first. */
export const HEALTH_SORT_DEFAULT_DIR: Record<HealthSortKey, SortDir> = {
  date: 'desc',
  person: 'asc',
  kind: 'asc',
  title: 'asc',
  value: 'desc',
  bodyPart: 'asc',
  severity: 'desc',
}

/**
 * Stable sort for the table. Ties fall back to newest first. Empty values (no measurement,
 * unrated, no body part) always sink to the bottom whatever the direction, so "highest first"
 * and "lowest first" both start with real data. `personName` resolves ids for the Person column.
 */
export function sortHealthLog(
  entries: HealthEntry[],
  key: HealthSortKey,
  dir: SortDir,
  personName: (id: string) => string = (id) => id,
): HealthEntry[] {
  const sign = dir === 'asc' ? 1 : -1
  // Same day: by time of day (an entry without a time counts as the start of the day), then by
  // when it was typed in.
  const byDate = (a: HealthEntry, b: HealthEntry) =>
    when(b).localeCompare(when(a)) || b.createdAt.localeCompare(a.createdAt)
  const text = (a: string, b: string) =>
    a === b ? 0 : a === '' ? 1 : b === '' ? -1 : sign * a.localeCompare(b)
  const num = (a: number | null, b: number | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : sign * (a - b)
  const cmp: Record<HealthSortKey, (a: HealthEntry, b: HealthEntry) => number> = {
    date: (a, b) => sign * when(a).localeCompare(when(b)) || byDate(a, b),
    person: (a, b) => text(personName(a.personId), personName(b.personId)),
    kind: (a, b) => sign * HEALTH_KIND_LABELS[a.kind].localeCompare(HEALTH_KIND_LABELS[b.kind]),
    title: (a, b) => text(a.title.toLowerCase(), b.title.toLowerCase()),
    value: (a, b) => num(a.value, b.value),
    bodyPart: (a, b) => text(a.bodyPart, b.bodyPart),
    severity: (a, b) => num(a.severity, b.severity),
  }
  const c = cmp[key]
  return [...entries].sort((a, b) => c(a, b) || byDate(a, b))
}

/** Distinct values present in the log, sorted, for the filter dropdowns. */
export function facets(entries: HealthEntry[]): {
  bodyParts: string[]
  tags: string[]
  conditions: string[]
} {
  const bodyParts = new Set<string>()
  const tags = new Set<string>()
  const conditions = new Set<string>()
  for (const e of entries) {
    if (e.bodyPart) bodyParts.add(e.bodyPart)
    for (const t of e.tags) tags.add(t)
    for (const c of e.conditions) conditions.add(c)
  }
  return { bodyParts: [...bodyParts].sort(), tags: [...tags].sort(), conditions: [...conditions].sort() }
}

/** Runs of consecutive entries sharing a date, in the order given: the card view's day headings. */
export function groupByDate(entries: HealthEntry[]): { date: string; entries: HealthEntry[] }[] {
  const out: { date: string; entries: HealthEntry[] }[] = []
  for (const e of entries) {
    const last = out[out.length - 1]
    if (last?.date === e.date) last.entries.push(e)
    else out.push({ date: e.date, entries: [e] })
  }
  return out
}
