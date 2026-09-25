import type { Kb } from '../kb/kb'
import { DELIMITERS, splitCells } from '../text/table'
import { labCatalogue, normaliseRow, normaliseUnit, parseFlag, parseRef, parseValue } from './normalise'
import type { LabReportDraft, LabRow, RawLabRow } from './types'

/**
 * Reads a lab report that is already text: pasted from a portal, a .txt or .csv export, or the
 * text layer of a PDF. Two shapes are understood: a table with a header row (Test, Result, Unit,
 * Reference… in English or Russian, split by tabs, `;`, `,` or `|`), and free lines of the form
 * "name value unit reference flag" split by tabs or runs of spaces. Local and pure; what it cannot
 * place the dialog offers to a model instead.
 */

export interface TextParse {
  draft: LabReportDraft
  /** Lines that look like a result (letters and a number); `draft.rows` found of them. */
  candidates: number
}

type Column = 'name' | 'value' | 'unit' | 'ref' | 'flag'

const HEADERS: Record<Column, RegExp> = {
  name: /^(test|tests|analyte|parameter|name|investigation|examination|показател|исследован|тест|наименован|анализ)/,
  value: /^(result|results|value|результат|значен)/,
  unit: /^(unit|units|ед|единиц)/,
  ref: /^(ref|reference|range|normal|norm|норм|референс)/,
  flag: /^(flag|флаг|отметк|отклонен)/,
}

const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{2})[./](\d{2})[./](\d{4})\b/
const TIME = /\b([01]\d|2[0-3]):([0-5]\d)\b/
/** Lines whose date is someone's birthday or a print stamp, never the sample date. */
const NOT_SAMPLE_DATE = /birth|dob|born|рожд|возраст|age|printed|печат/i
const SAMPLE_DATE = /collect|sample|drawn|taken|specimen|date of test|взят|забор|дата|date/i
const FLAG_TAIL = /\s*(↑|↓|\*+|\b[HL]\b|\bHH\b|\bLL\b)\s*$/

function reportDate(lines: string[]): { date: string; time: string } {
  const dated = lines.filter((l) => DATE.test(l) && !NOT_SAMPLE_DATE.test(l))
  const line = dated.find((l) => SAMPLE_DATE.test(l)) ?? dated[0]
  if (!line) return { date: '', time: '' }
  const m = DATE.exec(line) as RegExpExecArray
  const date = m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5]}-${m[4]}`
  const t = TIME.exec(line)
  return { date, time: t ? `${t[1]}:${t[2]}` : '' }
}

/** A header row: the delimiter, and which column holds what. */
function header(line: string): { delimiter: string; columns: Column[] } | null {
  for (const delimiter of DELIMITERS) {
    const cs = splitCells(line, delimiter).map((c) => c.toLowerCase())
    if (cs.length < 2) continue
    const columns = cs.map(
      (c) => (Object.keys(HEADERS) as Column[]).find((k) => HEADERS[k].test(c)) ?? ('' as Column),
    )
    if (columns.includes('name') && columns.includes('value')) return { delimiter, columns }
  }
  return null
}

/** "6,4 ↑" or "3.9 H" → the number and the flag printed after it. */
function splitFlag(cell: string): { value: string; flag: string } {
  const tail = FLAG_TAIL.exec(cell)
  return tail ? { value: cell.slice(0, tail.index), flag: tail[1] } : { value: cell, flag: '' }
}

const hasLetter = (s: string) => /\p{L}/u.test(s)
const isNumber = (s: string) => parseValue(s).value !== null

/** A free line: the name up to the first number, then value, unit, reference and flag in any order. */
function freeLine(kb: Kb, line: string): RawLabRow | null {
  const parts = line.includes('\t') ? line.split('\t') : line.split(/\s{2,}|\s*\|\s*/)
  let cs = parts.map((c) => c.trim()).filter(Boolean)
  if (cs.length === 1) {
    // Single spaces only: "Glucose 5.4 mmol/L 3.9-6.1". The value is the first number after a word.
    const m = /^(.*?\p{L}[^\d<>≤≥]*?)\s+([<>≤≥]=?\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:\s+(.*))?$/u.exec(
      cs[0],
    )
    if (!m) return null
    cs = [m[1], m[2], ...(m[3] ? m[3].split(/\s+(?=\S*\d)|\s+(?=[↑↓*]|[HL]\b)/) : [])]
  }
  const at = cs.findIndex((c, i) => i > 0 && isNumber(c.replace(FLAG_TAIL, '')))
  if (at < 1 || !hasLetter(cs.slice(0, at).join(' '))) return null
  const row: RawLabRow = { name: cs.slice(0, at).join(' '), ...splitFlag(cs[at]) }
  for (const c of cs.slice(at + 1)) {
    const r = parseRef(c)
    if (!row.unit && !row.ref && normaliseUnit(kb, c)) row.unit = c
    else if (!row.ref && (r.low !== null || r.high !== null)) row.ref = c
    else if (!row.flag && parseFlag(c)) row.flag = c
    else if (!row.unit && !row.ref && /[/%]|^[\p{L}µμ]{1,8}$/u.test(c)) row.unit = c
  }
  return row
}

/** A table row under a known header. */
function tableRow(line: string, h: { delimiter: string; columns: Column[] }): RawLabRow | null {
  const cs = splitCells(line, h.delimiter)
  const get = (k: Column) => cs[h.columns.indexOf(k)] ?? ''
  const name = get('name')
  const { value, flag } = splitFlag(get('value'))
  if (!name || !value || !hasLetter(name)) return null
  return { name, value, unit: get('unit'), ref: get('ref'), flag: get('flag') || flag }
}

/** A heading: letters only, short, and not a result ("Общий анализ крови", "LIPID PANEL:"). */
function heading(line: string): string | null {
  const s = line.trim().replace(/[:：]$/, '')
  if (!s || /\d/.test(s) || s.length > 60 || !hasLetter(s)) return null
  return s
}

/** Keeps a row only when it is recognisably a lab result: a known test, or a number with a known unit. */
const isResult = (r: LabRow) => r.analyte !== null || (r.unit !== '' && r.value !== null)

export function parseLabText(kb: Kb, text: string): TextParse {
  const lines = text.split(/\r?\n/)
  const { date, time } = reportDate(lines)
  const rows: LabRow[] = []
  let table: ReturnType<typeof header> = null
  let section = ''
  let candidates = 0
  for (const raw of lines) {
    const line = raw.replace(/ /g, ' ').trimEnd()
    if (!line.trim()) continue
    const h = header(line)
    if (h) {
      table = h
      continue
    }
    // A header aligned with spaces: columns cannot be trusted to line up, so the free-line reader,
    // which places cells by what they look like, takes the rows under it.
    if (header(line.trim().replace(/\s{2,}/g, '\t'))) continue
    if (hasLetter(line) && /\d/.test(line) && !NOT_SAMPLE_DATE.test(line) && !DATE.test(line)) candidates++
    const found = table ? tableRow(line, table) : freeLine(kb, line)
    if (!found) {
      const title = heading(line)
      if (title) section = title
      continue
    }
    const row = normaliseRow(kb, { ...found, section })
    if (isResult(row)) rows.push(row)
  }
  return { draft: { date, time, panel: singlePanel(kb, rows), rows }, candidates }
}

/** The panel every recognised row belongs to, if there is one. */
function singlePanel(kb: Kb, rows: LabRow[]): string {
  const byId = labCatalogue(kb).byId
  const known = rows.flatMap((r) => (r.analyte ? [byId.get(r.analyte)?.panels ?? []] : []))
  if (!known.length) return ''
  return known[0].find((p) => known.every((ps) => ps.includes(p))) ?? ''
}
