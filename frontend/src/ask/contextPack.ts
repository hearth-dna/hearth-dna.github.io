import type { Finding } from '../kb/kb'
import { HEALTH_KIND_LABELS, type HealthEntry, type Person } from '../types'
import { ASSISTANT_INSTRUCTIONS, type PromptTemplate } from './prompts'

/**
 * Builds the copy-out context pack (docs/design.md §6.3). Pure and deterministic — the preview the
 * user sees is byte-for-byte what they copy. Pseudonymised by default: labels instead of names,
 * ages rounded to 5 years.
 */
export interface PackPerson {
  person: Person
  findings: Finding[]
  /** Health-log entries the user chose to include, newest first. */
  health?: HealthEntry[]
  notes?: string[]
}

export interface PackOptions {
  question: string
  people: PackPerson[]
  realNames: boolean
  template?: PromptTemplate
  appName?: string
  now?: Date
}

export function labelFor(p: Person, i: number, realNames: boolean, now: Date): string {
  const name = realNames ? p.displayName : `Person ${String.fromCharCode(65 + i)}`
  const parts = [name]
  if (p.sex !== 'unknown') parts.push(p.sex)
  if (p.birthYear) {
    const age = now.getFullYear() - p.birthYear
    parts.push(realNames ? `${age}` : `about ${Math.round(age / 5) * 5}`)
  }
  return parts.join(', ')
}

export function buildContextPack(o: PackOptions): string {
  const now = o.now ?? new Date()
  const app = o.appName ?? 'Hearth'
  const lines: string[] = []
  lines.push(
    `# Context for a health question (generated locally by ${app}; informational, not medical advice)`,
  )
  lines.push('')
  o.people.forEach((pp, i) => {
    lines.push(`## ${labelFor(pp.person, i, o.realNames, now)}`)
    if (pp.findings.length === 0) lines.push('- (no relevant genotypes selected)')
    for (const f of pp.findings) {
      const e = f.entry
      const status = f.match ? f.match.label : 'genotype not described in knowledge base'
      lines.push(
        `- ${e.gene} ${e.rsid} (${e.name}): ${f.call.a1}/${f.call.a2} — ${status} [evidence ${e.evidence}]`,
      )
    }
    if (pp.health?.length) {
      lines.push("### Health log (from the person's documents, dated)")
      for (const h of pp.health) {
        const body = h.body.trim().replace(/\n/g, '\n  ')
        lines.push(`- ${h.date} · ${HEALTH_KIND_LABELS[h.kind]} · ${h.title}${body ? `\n  ${body}` : ''}`)
      }
    }
    for (const n of pp.notes ?? []) lines.push(`- Note: ${n}`)
    lines.push('')
  })
  const seen = new Set<string>()
  const evidence: string[] = []
  for (const pp of o.people) {
    for (const f of pp.findings) {
      if (seen.has(f.entry.rsid)) continue
      seen.add(f.entry.rsid)
      evidence.push(`- ${f.entry.name}: ${f.entry.summary} Sources: ${f.entry.sources.join(', ')}`)
    }
  }
  if (evidence.length) {
    lines.push('## Evidence notes (from the local knowledge base)')
    lines.push(...evidence)
    lines.push('')
  }
  lines.push('## Question')
  lines.push(o.question.trim() || '(no question entered)')
  lines.push('')
  lines.push('## Instructions for the assistant')
  if (o.template) lines.push(o.template.text)
  lines.push(ASSISTANT_INSTRUCTIONS)
  return lines.join('\n')
}

/** What the sharing log records: counts only, never the payload twice. */
export function packStats(pack: string): { chars: number; genotypes: number; healthEntries: number } {
  return {
    chars: pack.length,
    genotypes: (pack.match(/^- \w+ rs\d+/gm) ?? []).length,
    healthEntries: (pack.match(/^- \d{4}-\d{2}-\d{2} · /gm) ?? []).length,
  }
}
