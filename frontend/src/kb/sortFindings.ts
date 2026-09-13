import type { Finding } from './kb'

export type FindingSortKey = 'gene' | 'riskCopies' | 'evidence' | 'magnitude' | 'topic'
export type SortDir = 'asc' | 'desc'

/** Natural direction for a first click: strongest first for numbers, alphabetical for text. */
export const DEFAULT_DIR: Record<FindingSortKey, SortDir> = {
  gene: 'asc',
  topic: 'asc',
  evidence: 'asc', // A (best) → C
  riskCopies: 'desc',
  magnitude: 'desc',
}

const magnitude = (f: Finding) => f.match?.magnitude ?? -1

const cmp: Record<FindingSortKey, (a: Finding, b: Finding) => number> = {
  gene: (a, b) => a.entry.gene.localeCompare(b.entry.gene) || a.entry.rsid.localeCompare(b.entry.rsid),
  topic: (a, b) => a.entry.topic.localeCompare(b.entry.topic),
  evidence: (a, b) => a.entry.evidence.localeCompare(b.entry.evidence),
  riskCopies: (a, b) => a.riskCopies - b.riskCopies,
  magnitude: (a, b) => magnitude(a) - magnitude(b),
}

/** Stable sort by `key`; ties fall back to impact (desc) then gene so the order is deterministic. */
export function sortFindings(findings: readonly Finding[], key: FindingSortKey, dir: SortDir): Finding[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...findings].sort((a, b) => sign * cmp[key](a, b) || magnitude(b) - magnitude(a) || cmp.gene(a, b))
}
