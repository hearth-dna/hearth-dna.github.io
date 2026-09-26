import type { HealthEntry, HealthKind } from '../types'

/**
 * What was imported into a health log, and how: every entry an import wrote carries the same
 * `source` (the file's hash behind `csv:`, `text:` or `gemini:<model>:`), so one source is one
 * import. Hand-typed entries have no source and are not an import. Pure.
 */
export interface ImportBatch {
  source: string
  via: 'csv' | 'text' | 'gemini'
  /** The model that read it, for `gemini:` imports. */
  model: string
  count: number
  /** Earliest and latest reading date in the batch. */
  from: string
  to: string
  /** When the import happened (the batch's first createdAt). */
  at: string
  kinds: Partial<Record<HealthKind, number>>
}

export function importBatches(entries: HealthEntry[]): ImportBatch[] {
  const by = new Map<string, ImportBatch>()
  for (const e of entries) {
    const m = /^(csv|text|gemini):(?:([^:]+):)?/.exec(e.source)
    if (!m) continue
    const b = by.get(e.source) ?? {
      source: e.source,
      via: m[1] as ImportBatch['via'],
      model: m[1] === 'gemini' ? (m[2] ?? '') : '',
      count: 0,
      from: e.date,
      to: e.date,
      at: e.createdAt,
      kinds: {},
    }
    b.count++
    if (e.date < b.from) b.from = e.date
    if (e.date > b.to) b.to = e.date
    if (e.createdAt < b.at) b.at = e.createdAt
    b.kinds[e.kind] = (b.kinds[e.kind] ?? 0) + 1
    by.set(e.source, b)
  }
  return [...by.values()].sort((a, b) => b.at.localeCompare(a.at))
}
