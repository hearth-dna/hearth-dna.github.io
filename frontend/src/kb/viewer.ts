import type { PackPerson } from '../ask/contextPack'
import type { Person } from '../types'
import { type Finding, type Kb, type KbEntry, searchKb } from './kb'

/**
 * The DNA viewer's model (`/dna`): every marker the knowledge base describes, most clinically
 * useful first, filtered by area of medicine (`kb/reviewed/areas.json`), text and notability,
 * with each selected person's genotype beside it. Pure.
 */
export interface KbArea {
  id: string
  /** `en` is always present; other languages fall back to it. */
  names: Record<string, string>
}

export const areaName = (a: KbArea, lang = 'en'): string => a.names[lang] ?? a.names.en

/** Impact at or above which a genotype counts as notable (the Ask page uses the same bar). */
export const NOTABLE = 2

const maxMagnitude = (e: KbEntry) => Math.max(0, ...Object.values(e.genotypes).map((g) => g.magnitude))

/**
 * Clinical value, best first: evidence grade (A before C), then medical topics before lifestyle
 * ones, then the largest impact any genotype of the marker can have, then gene.
 */
export function rankEntries(kb: Kb): KbEntry[] {
  const clinical = new Set(kb.topics.filter((t) => t.category === 'clinical').map((t) => t.id))
  return [...kb.entries].sort(
    (a, b) =>
      a.evidence.localeCompare(b.evidence) ||
      Number(clinical.has(b.topic)) - Number(clinical.has(a.topic)) ||
      maxMagnitude(b) - maxMagnitude(a) ||
      a.gene.localeCompare(b.gene) ||
      a.rsid.localeCompare(b.rsid),
  )
}

export interface ViewerFilter {
  /** Area ids; a marker in any of them is shown. Empty: every area. */
  areas: string[]
  query: string
  /** Only markers where a shown person has a notable genotype. */
  notable: boolean
}

export const NO_VIEWER_FILTER: ViewerFilter = { areas: [], query: '', notable: false }

export interface ViewerRow {
  entry: KbEntry
  /** Per shown person id; absent when the person was not genotyped for this marker. */
  findings: Record<string, Finding>
}

export function viewerRows(
  kb: Kb,
  findingsBy: Record<string, Finding[]>,
  personIds: string[],
  f: ViewerFilter,
): ViewerRow[] {
  const hits = f.query.trim() ? new Set(searchKb(kb, f.query)) : null
  return rankEntries(kb)
    .filter((e) => !f.areas.length || e.areas.some((a) => f.areas.includes(a)))
    .filter((e) => !hits || hits.has(e))
    .map((entry) => {
      const findings: Record<string, Finding> = {}
      for (const id of personIds) {
        const found = findingsBy[id]?.find((x) => x.entry.rsid === entry.rsid)
        if (found) findings[id] = found
      }
      return { entry, findings }
    })
    .filter((r) => !f.notable || Object.values(r.findings).some((x) => (x.match?.magnitude ?? 0) >= NOTABLE))
}

/** The rows as context-pack people: each shown person with their genotypes for these markers. */
export function viewerPackPeople(rows: ViewerRow[], people: Person[]): PackPerson[] {
  return people
    .map((person) => ({ person, findings: rows.flatMap((r) => r.findings[person.id] ?? []) }))
    .filter((p) => p.findings.length)
}

/** The question the pack asks when the user leaves it empty, in English like the rest of the pack. */
export function viewerQuestion(kb: Kb, areas: string[]): string {
  const names = kb.areas.filter((a) => areas.includes(a.id)).map((a) => areaName(a).toLowerCase())
  return names.length
    ? `What do these genotypes mean for ${names.join(', ')}? What, if anything, is worth acting on or checking?`
    : 'What do these genotypes mean, and what, if anything, is worth acting on or checking?'
}
