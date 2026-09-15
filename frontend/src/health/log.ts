import { HEALTH_KIND_LABELS, type HealthEntry, type HealthKind } from '../types'

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

/** '37.8 °C', '120/80 mmHg', '72' (no unit); '' when the entry has no value. */
export function formatValue(e: Pick<HealthEntry, 'value' | 'value2' | 'unit'>): string {
  if (e.value === null) return ''
  const n = e.value2 === null ? String(e.value) : `${e.value}/${e.value2}`
  return e.unit ? `${n} ${e.unit}` : n
}

/**
 * The entry on one line, as shown in the log and in the Ask context pack:
 * `2026-09-14 · Symptom · Pain in both hands (hands; severity 6/10; arthritis)`,
 * `2026-09-14 · Measurement · Blood pressure 120/80 mmHg`.
 */
export function describeEntry(e: HealthEntry): string {
  const value = formatValue(e)
  const extra = [
    e.bodyPart,
    e.severity === null ? '' : `severity ${e.severity}/10`,
    formatTags(e.tags),
  ].filter(Boolean)
  return `${e.date} · ${HEALTH_KIND_LABELS[e.kind]} · ${e.title}${value ? ` ${value}` : ''}${extra.length ? ` (${extra.join('; ')})` : ''}`
}

export interface HealthFilter {
  kind: HealthKind | ''
  bodyPart: string
  tag: string
  /** Case-insensitive substring of title, body, body part, unit or tags. */
  text: string
}

export const NO_FILTER: HealthFilter = { kind: '', bodyPart: '', tag: '', text: '' }

export function filterHealthLog(entries: HealthEntry[], f: HealthFilter): HealthEntry[] {
  const q = f.text.trim().toLowerCase()
  return entries.filter(
    (e) =>
      (!f.kind || e.kind === f.kind) &&
      (!f.bodyPart || e.bodyPart === f.bodyPart) &&
      (!f.tag || e.tags.includes(f.tag)) &&
      (!q || [e.title, e.body, e.bodyPart, e.unit, ...e.tags].some((s) => s.toLowerCase().includes(q))),
  )
}

/** Distinct values present in the log, sorted, for the filter dropdowns. */
export function facets(entries: HealthEntry[]): { bodyParts: string[]; tags: string[] } {
  const bodyParts = new Set<string>()
  const tags = new Set<string>()
  for (const e of entries) {
    if (e.bodyPart) bodyParts.add(e.bodyPart)
    for (const t of e.tags) tags.add(t)
  }
  return { bodyParts: [...bodyParts].sort(), tags: [...tags].sort() }
}
