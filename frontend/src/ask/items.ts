import { describeEntry } from '../health/log'
import type { Finding } from '../kb/kb'
import type { Call, HealthEntry, Person } from '../types'
import type { PackPerson } from './contextPack'
import { findingKey, genotypeKey, healthKey, type ItemKey, parseKey } from './recommend'

/** Everything the Ask page has loaded, per person id. */
export interface AskData {
  findingsBy: Record<string, Finding[]>
  healthBy: Record<string, HealthEntry[]>
  /** Genotypes looked up by rsid that the knowledge base does not describe. */
  rawBy: Record<string, Record<string, Call>>
}

export type Resolved =
  | { key: ItemKey; personId: string; finding: Finding }
  | { key: ItemKey; personId: string; call: Call }
  | { key: ItemKey; personId: string; health: HealthEntry }

/** The record behind a key, or null while it is not loaded (or no longer exists). */
export function resolve(key: ItemKey, d: AskData): Resolved | null {
  const k = parseKey(key)
  if (!k) return null
  if (k.kind === 'f') {
    const finding = d.findingsBy[k.personId]?.find((f) => f.entry.rsid === k.id)
    return finding ? { key, personId: k.personId, finding } : null
  }
  if (k.kind === 'g') {
    const call = d.rawBy[k.personId]?.[k.id]
    return call ? { key, personId: k.personId, call } : null
  }
  const health = d.healthBy[k.personId]?.find((h) => h.id === k.id)
  return health ? { key, personId: k.personId, health } : null
}

/** One line for lists on the page (the pack has its own formats). */
export function itemLabel(r: Resolved, undescribed: string): string {
  if ('finding' in r) {
    const f = r.finding
    return `${f.entry.gene} ${f.entry.rsid} ${f.call.a1}/${f.call.a2} — ${f.match?.label ?? undescribed}`
  }
  if ('call' in r)
    return `${r.call.rsid} ${r.call.a1}/${r.call.a2} (chr${r.call.chromosome}:${r.call.position})`
  return describeEntry(r.health)
}

export const keyOf = {
  finding: (personId: string, f: Finding) => findingKey(personId, f.entry.rsid),
  call: (personId: string, c: Call) => genotypeKey(personId, c.rsid),
  health: (personId: string, h: HealthEntry) => healthKey(personId, h.id),
}

/**
 * The pack's people: the selected ones that have at least one included record, in the order of
 * `persons` (so pseudonym letters are stable), each with records in the order they were added,
 * health entries newest first as in the log.
 */
export function packPeople(keys: ItemKey[], d: AskData, persons: Person[], selected: string[]): PackPerson[] {
  const resolved = keys.map((k) => resolve(k, d)).filter((r): r is Resolved => r !== null)
  const out: PackPerson[] = []
  for (const person of persons) {
    if (!selected.includes(person.id)) continue
    const mine = resolved.filter((r) => r.personId === person.id)
    if (!mine.length) continue
    const health = mine.flatMap((r) => ('health' in r ? [r.health] : []))
    out.push({
      person,
      findings: mine.flatMap((r) => ('finding' in r ? [r.finding] : [])),
      genotypes: mine.flatMap((r) => ('call' in r ? [r.call] : [])),
      health: health.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)),
    })
  }
  return out
}
