/** Delimited text tables (CSV, TSV, semicolon exports): shared by the lab reader and the timeline import. */

export const DELIMITERS = ['\t', ';', '|', ','] as const

/** A delimited line into cells; double quotes protect a delimiter, `""` is a literal quote. */
export function splitCells(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (ch === delimiter && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

/**
 * The delimiter of a table: the one that splits the header into the most cells and the next rows
 * into the same number. A comma loses to a semicolon when both work, since European exports use
 * `;` precisely because the comma is their decimal separator.
 */
export function guessDelimiter(lines: string[]): string {
  const sample = lines.filter((l) => l.trim()).slice(0, 6)
  let best: string = ','
  let bestScore = 0
  for (const d of DELIMITERS) {
    const counts = sample.map((l) => splitCells(l, d).length)
    if (counts[0] < 2) continue
    const consistent = counts.filter((c) => c === counts[0]).length
    const score = counts[0] * consistent
    if (score > bestScore) {
      best = d
      bestScore = score
    }
  }
  return best
}

/** Text → header and rows: BOM and blank lines dropped, CRLF handled, rows padded to the header. */
export function parseTable(text: string): { header: string[]; rows: string[][]; delimiter: string } {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (!lines.length) return { header: [], rows: [], delimiter: ',' }
  const delimiter = guessDelimiter(lines)
  const [head, ...body] = lines.map((l) => splitCells(l, delimiter))
  const rows = body.map((r) =>
    r.length < head.length ? [...r, ...Array(head.length - r.length).fill('')] : r,
  )
  return { header: head, rows, delimiter }
}
