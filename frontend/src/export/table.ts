import type { Finding } from '../kb/kb'
import type { HealthEntry, Person } from '../types'

/**
 * Open formats for the user's own analysis (docs/architecture/storage/open-formats.md): CSV for
 * spreadsheets, JSON Lines for scripts. Pure formatting; the genotype table itself is built in
 * the worker (db.worker.ts `genotype-table`) because it is millions of rows.
 */
export type OpenFormat = 'csv' | 'jsonl'

export type Cell = string | number | null

/** RFC 4180 quoting: quote when the value has a comma, quote, newline or leading/trailing space. */
export function csvCell(v: Cell): string {
  if (v === null) return ''
  const s = String(v)
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const csvLine = (cells: Cell[]) => cells.map(csvCell).join(',')

/** UTF-8 BOM so Excel opens accented text correctly; \n line ends (all spreadsheets accept them). */
export const CSV_BOM = '﻿'

export function toCsv(header: string[], rows: Cell[][]): string {
  return `${CSV_BOM}${[csvLine(header), ...rows.map(csvLine)].join('\n')}\n`
}

export function toJsonl(objects: Record<string, unknown>[]): string {
  return objects.map((o) => JSON.stringify(o)).join('\n') + (objects.length ? '\n' : '')
}

/** Header + rows and the JSON objects for the same data, so both formats come from one source. */
export interface Table {
  header: string[]
  rows: Cell[][]
}

export function tableToObjects(t: Table): Record<string, unknown>[] {
  return t.rows.map((r) => Object.fromEntries(t.header.map((h, i) => [h, r[i]])))
}

export function render(t: Table, format: OpenFormat): string {
  return format === 'csv' ? toCsv(t.header, t.rows) : toJsonl(tableToObjects(t))
}

/**
 * Column names for the genotype table: the person's short label, made unique with a numeric
 * suffix when two people share one. Kept stable so a re-export lines up with the previous file.
 */
export function personColumns(persons: Person[]): { id: string; name: string }[] {
  const seen = new Map<string, number>()
  return persons.map((p) => {
    const base = p.label || p.displayName || p.id.slice(0, 8)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { id: p.id, name: n === 0 ? base : `${base}-${n + 1}` }
  })
}

export const FINDING_HEADER = [
  'person',
  'rsid',
  'gene',
  'name',
  'genotype',
  'risk_allele',
  'risk_copies',
  'magnitude',
  'label',
  'evidence',
  'topic',
  'conditions',
  'drugs',
  'summary',
  'sources',
]

export function findingsTable(byPerson: { person: Person; findings: Finding[] }[]): Table {
  const rows: Cell[][] = []
  for (const { person, findings } of byPerson) {
    for (const f of findings) {
      rows.push([
        person.displayName,
        f.entry.rsid,
        f.entry.gene,
        f.entry.name,
        f.genotype,
        f.entry.risk_allele,
        f.riskCopies,
        f.match?.magnitude ?? null,
        f.match?.label ?? '',
        f.entry.evidence,
        f.entry.topic,
        (f.entry.conditions ?? []).join('; '),
        (f.entry.drugs ?? []).join('; '),
        f.entry.summary,
        f.entry.sources.join(' '),
      ])
    }
  }
  return { header: FINDING_HEADER, rows }
}

export const HEALTH_HEADER = [
  'person',
  'date',
  'time',
  'kind',
  'title',
  'body_part',
  'severity',
  'value',
  'value2',
  'unit',
  'tags',
  'source',
  'body',
  'created_at',
]

export function healthTable(byPerson: { person: Person; entries: HealthEntry[] }[]): Table {
  const rows: Cell[][] = []
  for (const { person, entries } of byPerson) {
    for (const e of entries) {
      rows.push([
        person.displayName,
        e.date,
        e.time,
        e.kind,
        e.title,
        e.bodyPart,
        e.severity,
        e.value,
        e.value2,
        e.unit,
        e.tags.join('; '),
        e.source,
        e.body,
        e.createdAt,
      ])
    }
  }
  return { header: HEALTH_HEADER, rows }
}

export const openFileName = (what: 'genotypes' | 'findings' | 'health-log', format: OpenFormat) =>
  `hearth-${what}-${new Date().toISOString().slice(0, 10)}.${format}`
