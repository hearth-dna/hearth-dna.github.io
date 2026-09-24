import { describeEntry, formatTags, formatValue, when, where } from '../health/log'
import type { Finding } from '../kb/kb'
import type { Call, HealthEntry, Person } from '../types'
import { ASSISTANT_INSTRUCTIONS, type PromptTemplate } from './prompts'

/**
 * Builds the copy-out context pack (docs/design.md §6.3). Pure and deterministic — the preview the
 * user sees is byte-for-byte what they copy. Pseudonymised by default: labels instead of names,
 * ages rounded to 5 years. Compact mode puts every record on one line, shortens long text and
 * folds repeated measurements into one series, so more fits in an assistant's context.
 */
export interface PackPerson {
  person: Person
  findings: Finding[]
  /** Genotypes the knowledge base does not describe (looked up by rsid). */
  genotypes?: Call[]
  /** Health-log entries the user chose to include, newest first. */
  health?: HealthEntry[]
  notes?: string[]
}

export interface PackOptions {
  question: string
  people: PackPerson[]
  realNames: boolean
  template?: PromptTemplate
  /** One line per record (default false: the full, indented format). */
  compact?: boolean
  /** Knowledge-base summaries and sources for the included findings (default true). */
  evidence?: boolean
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
    if (o.compact) compactPerson(pp, lines)
    else fullPerson(pp, lines)
    for (const n of pp.notes ?? []) lines.push(`- Note: ${n}`)
    lines.push('')
  })
  const seen = new Set<string>()
  const evidence: string[] = []
  for (const pp of o.evidence === false ? [] : o.people) {
    for (const f of pp.findings) {
      if (seen.has(f.entry.rsid)) continue
      seen.add(f.entry.rsid)
      const sources = o.compact ? f.entry.sources.slice(0, 1) : f.entry.sources
      evidence.push(`- ${f.entry.name}: ${f.entry.summary} Sources: ${sources.join(', ')}`)
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

function fullPerson(pp: PackPerson, lines: string[]) {
  if (pp.findings.length === 0 && !pp.genotypes?.length) lines.push('- (no relevant genotypes selected)')
  for (const f of pp.findings) {
    const e = f.entry
    const status = f.match ? f.match.label : 'genotype not described in knowledge base'
    lines.push(
      `- ${e.gene} ${e.rsid} (${e.name}): ${f.call.a1}/${f.call.a2} — ${status} [evidence ${e.evidence}]`,
    )
  }
  for (const c of pp.genotypes ?? [])
    lines.push(`- ${c.rsid} (chr${c.chromosome}:${c.position}): ${c.a1}/${c.a2} — not in the knowledge base`)
  if (pp.health?.length) {
    lines.push("### Health log (the person's documents and self-reported symptoms, dated)")
    for (const h of pp.health) {
      const body = h.body.trim().replace(/\n/g, '\n  ')
      lines.push(`- ${describeEntry(h)}${body ? `\n  ${body}` : ''}`)
    }
  }
}

/** Longest free text kept per health entry in compact mode. */
export const COMPACT_TEXT = 240

/** Whitespace and line breaks collapsed, cut at `max` characters with an ellipsis. */
export function squeeze(text: string, max = COMPACT_TEXT): string {
  const flat = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    // A line that already ends a sentence needs no separator of its own.
    .reduce((acc, l) => (acc ? `${acc}${/[.;:!?]$/.test(acc) ? ' ' : '; '}${l}` : l), '')
    .replace(/\s+/g, ' ')
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

function compactPerson(pp: PackPerson, lines: string[]) {
  if (pp.findings.length || pp.genotypes?.length) {
    lines.push('Genotypes:')
    for (const f of pp.findings) {
      const e = f.entry
      const status = f.match ? f.match.label : 'not described in knowledge base'
      lines.push(`- ${e.gene} ${e.rsid} ${f.call.a1}/${f.call.a2}: ${status} [evidence ${e.evidence}]`)
    }
    for (const c of pp.genotypes ?? [])
      lines.push(`- ${c.rsid} ${c.a1}/${c.a2} (chr${c.chromosome}:${c.position}; not in knowledge base)`)
  }
  if (!pp.health?.length) return
  lines.push('Health log:')
  // Measurements of the same thing in the same unit become one series line, oldest first,
  // placed where the newest of them would have been.
  const series = new Map<string, HealthEntry[]>()
  const seriesKey = (h: HealthEntry) => `${h.title.trim().toLowerCase()}\u0000${h.unit}`
  for (const h of pp.health)
    if (h.kind === 'measurement' && h.value !== null)
      series.set(seriesKey(h), [...(series.get(seriesKey(h)) ?? []), h])
  const done = new Set<string>()
  for (const h of pp.health) {
    const group = h.kind === 'measurement' && h.value !== null ? series.get(seriesKey(h)) : undefined
    if (group && group.length > 1) {
      if (done.has(seriesKey(h))) continue
      done.add(seriesKey(h))
      const points = [...group].reverse().map((m) => {
        const v = formatValue({ ...m, unit: '' })
        const note = squeeze(m.body, 60)
        return `${when(m)} ${v}${note ? ` (${note})` : ''}`
      })
      lines.push(
        `- ${h.title}${h.unit ? `, ${h.unit}` : ''} (${group.length} readings): ${points.join('; ')}`,
      )
      continue
    }
    const value = formatValue(h)
    const extra = [
      where(h),
      h.severity === null ? '' : `severity ${h.severity}/10`,
      formatTags(h.tags),
    ].filter(Boolean)
    const body = squeeze(h.body)
    lines.push(
      `- ${when(h)} ${h.kind}: ${h.title}${value ? ` ${value}` : ''}${extra.length ? ` (${extra.join('; ')})` : ''}${body ? ` — ${body}` : ''}`,
    )
  }
}

/** Counts for the preview, the confirmation and the sharing log, from what was put in. */
export function packStats(
  o: Pick<PackOptions, 'people'>,
  pack: string,
): { chars: number; tokens: number; genotypes: number; healthEntries: number } {
  return {
    chars: pack.length,
    // Rough: English-like text runs about four characters per token in common tokenisers.
    tokens: Math.ceil(pack.length / 4),
    genotypes: o.people.reduce((n, p) => n + p.findings.length + (p.genotypes?.length ?? 0), 0),
    healthEntries: o.people.reduce((n, p) => n + (p.health?.length ?? 0), 0),
  }
}
