import { fetchOwnAsset } from '../egress/egress'
import type { Call } from '../types'

export interface KbGenotype {
  label: string
  magnitude: number
}
export interface KbEntry {
  rsid: string
  gene: string
  name: string
  risk_allele: string
  orientation: string
  evidence: 'A' | 'B' | 'C'
  summary: string
  genotypes: Record<string, KbGenotype>
  sources: string[]
  drugs?: string[]
  conditions?: string[]
  topic: string
  generated_by: string
}
export interface Kb {
  version: string
  entries: KbEntry[]
  topics: { id: string; category: string }[]
}

export async function loadKb(): Promise<Kb> {
  // The archive build bundles the knowledge base; file:// pages cannot fetch a sibling file.
  if (__HEARTH_ARCHIVE__) return (await import('../../public/kb.json')).default as unknown as Kb
  const res = await fetchOwnAsset('/kb.json')
  if (!res.ok) throw new Error('kb.json missing — run make kb-build')
  return (await res.json()) as Kb
}

export function normGenotype(a1: string, a2: string): string {
  return [a1, a2].sort().join('')
}

export interface Finding {
  entry: KbEntry
  genotype: string
  call: Call
  match: KbGenotype | null
  riskCopies: number
}

/** Joins a person's calls against the kb. Unknown genotype strings still produce a finding with match=null. */
export function computeFindings(kb: Kb, calls: Iterable<Call>): Finding[] {
  const byRsid = new Map(kb.entries.map((e) => [e.rsid, e]))
  const out: Finding[] = []
  for (const c of calls) {
    const entry = byRsid.get(c.rsid)
    if (!entry || c.a1 === '-') continue
    const genotype = normGenotype(c.a1, c.a2 === '-' ? c.a1 : c.a2)
    const match = entry.genotypes[genotype] ?? null
    const riskCopies = (c.a1 === entry.risk_allele ? 1 : 0) + (c.a2 === entry.risk_allele ? 1 : 0)
    out.push({ entry, genotype, call: c, match, riskCopies })
  }
  return out.sort(
    (a, b) =>
      (b.match?.magnitude ?? 0) - (a.match?.magnitude ?? 0) ||
      a.entry.evidence.localeCompare(b.entry.evidence),
  )
}

/** Text search over the kb: gene, name, drugs, conditions, summary. */
export function searchKb(kb: Kb, q: string): KbEntry[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  return kb.entries.filter((e) =>
    [e.rsid, e.gene, e.name, e.summary, ...(e.drugs ?? []), ...(e.conditions ?? [])].some((s) =>
      s.toLowerCase().includes(needle),
    ),
  )
}
