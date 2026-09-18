import type { Finding, Kb } from '../kb/kb'
import type { HealthEntry, HealthKind } from '../types'
import type { Intent } from './intent'
import { questionTerms, retrieveForQuestion } from './retrieve'

/**
 * One record that can go into a context pack. Keys are stable strings so the page can keep an
 * ordered selection: `f:<person>:<rsid>` a knowledge-base finding, `g:<person>:<rsid>` a raw
 * genotype the kb does not describe, `h:<person>:<entry id>` a health-log entry.
 */
export type ItemKey = string
export const findingKey = (personId: string, rsid: string): ItemKey => `f:${personId}:${rsid}`
export const genotypeKey = (personId: string, rsid: string): ItemKey => `g:${personId}:${rsid}`
export const healthKey = (personId: string, id: string): ItemKey => `h:${personId}:${id}`

export function parseKey(key: ItemKey): { kind: 'f' | 'g' | 'h'; personId: string; id: string } | null {
  const m = /^([fgh]):([^:]+):(.+)$/.exec(key)
  return m ? { kind: m[1] as 'f' | 'g' | 'h', personId: m[2], id: m[3] } : null
}

/** Why a record is suggested; the UI turns it into a sentence. */
export type Reason =
  | { why: 'mentioned'; term: string }
  | { why: 'pharmacogenomic' }
  | { why: 'notable' }
  | { why: 'sharedVariant' }
  | { why: 'matchesQuestion'; term: string }
  | { why: 'recent'; kind: HealthKind }

export interface Suggestion {
  key: ItemKey
  personId: string
  reason: Reason
}

export interface PersonRecords {
  personId: string
  findings: Finding[]
  /** Newest first, as the repo returns them. */
  health: HealthEntry[]
}

const DAY = 86_400_000
const magnitude = (f: Finding) => f.match?.magnitude ?? 0

/**
 * Up to `n` newest entries of a kind, preferring those within `days` of `now`; when none is that
 * recent, the newest ones still count (a lab panel from last year beats no lab panel).
 */
function newest(entries: HealthEntry[], kind: HealthKind, n: number, days: number, now: Date): HealthEntry[] {
  const of = entries.filter((e) => e.kind === kind)
  const cutoff = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10)
  const recent = of.filter((e) => e.date >= cutoff)
  return (recent.length ? recent : of).slice(0, n)
}

/** What each question type pulls from the health log: kind, how many, how far back. */
const HEALTH_PLAN: Record<Intent['type'], [HealthKind, number, number][]> = {
  medication: [
    ['medication', 10, 365],
    ['diagnosis', 5, 3650],
  ],
  labs: [
    ['lab', 10, 730],
    ['medication', 5, 365],
  ],
  symptoms: [
    ['symptom', 10, 90],
    ['measurement', 15, 30],
    ['medication', 5, 90],
    ['diagnosis', 3, 3650],
  ],
  family: [['diagnosis', 5, 3650]],
  doctor: [
    ['symptom', 8, 60],
    ['diagnosis', 5, 3650],
    ['medication', 8, 365],
    ['lab', 5, 365],
  ],
  report: [
    ['letter', 3, 365],
    ['imaging', 3, 365],
    ['diagnosis', 3, 3650],
  ],
  genetics: [],
}

/**
 * Records worth including for this question, per person, most relevant first and without
 * duplicates. Order of sources: kb entries named in the question, health entries whose words
 * match it, then what the question types call for (pharmacogenomic markers for medication,
 * recent labs for lab questions, variants several people share for family questions…).
 */
export function recommend(
  kb: Kb,
  question: string,
  intents: Intent[],
  people: PersonRecords[],
  now = new Date(),
): Suggestion[] {
  const out: Suggestion[] = []
  const seen = new Set<ItemKey>()
  const add = (key: ItemKey, personId: string, reason: Reason) => {
    if (seen.has(key)) return
    seen.add(key)
    out.push({ key, personId, reason })
  }
  const types = new Set(intents.map((i) => i.type))
  const mentioned = retrieveForQuestion(kb, question)
  // Health text is prose: only words of four letters or more are specific enough to match on.
  const terms = questionTerms(question).filter((t) => t.length >= 4)
  // Variants at least two selected people carry with some impact.
  const carriers = new Map<string, number>()
  for (const p of people)
    for (const f of p.findings)
      if (magnitude(f) > 0) carriers.set(f.entry.rsid, (carriers.get(f.entry.rsid) ?? 0) + 1)

  for (const p of people) {
    for (const f of p.findings)
      if (mentioned.has(f.entry.rsid))
        add(findingKey(p.personId, f.entry.rsid), p.personId, { why: 'mentioned', term: f.entry.gene })

    for (const e of p.health) {
      const text = [e.title, e.bodyPart, ...e.tags, e.body].join(' ').toLowerCase()
      const term = terms.find((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text))
      if (term) add(healthKey(p.personId, e.id), p.personId, { why: 'matchesQuestion', term })
    }

    if (types.has('medication'))
      for (const f of p.findings)
        if (f.entry.topic === 'pharmacogenomics' && magnitude(f) > 0)
          add(findingKey(p.personId, f.entry.rsid), p.personId, { why: 'pharmacogenomic' })

    if (types.has('family'))
      for (const f of p.findings)
        if ((carriers.get(f.entry.rsid) ?? 0) >= 2)
          add(findingKey(p.personId, f.entry.rsid), p.personId, { why: 'sharedVariant' })

    for (const type of types)
      for (const [kind, n, days] of HEALTH_PLAN[type])
        for (const e of newest(p.health, kind, n, days, now))
          add(healthKey(p.personId, e.id), p.personId, { why: 'recent', kind })

    // Notable markers when nothing more specific came from the kb.
    if ((types.has('genetics') || types.has('doctor') || types.has('labs')) && mentioned.size === 0)
      for (const f of p.findings)
        if (magnitude(f) >= 2) add(findingKey(p.personId, f.entry.rsid), p.personId, { why: 'notable' })
  }
  return out
}
