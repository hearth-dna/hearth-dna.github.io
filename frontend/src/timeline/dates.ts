/**
 * Dates as spreadsheets and exports write them. The format is decided for a whole column, never
 * per cell: 03/04/2026 is April in Europe and March in the US, and only the other rows can tell.
 */
export type DateFormat = 'ymd' | 'dmy' | 'mdy' | 'serial' | 'unix'

export interface ParsedDate {
  date: string // YYYY-MM-DD
  time: string // HH:MM or ''
}

const pad = (n: number) => String(n).padStart(2, '0')
const TIME = /(?:^|[\sT])([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?\s*(am|pm)?/i
const PARTS = /^(\d{1,4})[./\-\s](\d{1,2})[./\-\s](\d{1,4})/
/** Excel day 25569 is 1970-01-01; the 1900 leap-year bug is before any date that matters here. */
const EXCEL_EPOCH = 25569

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return false
  return d <= new Date(y, m, 0).getDate()
}

const year = (y: number) => (y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y)

/** A Unix instant in the device's local time, as every other time in the app. */
function fromEpoch(ms: number): ParsedDate {
  const d = new Date(ms)
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

function timeOf(cell: string): string {
  const t = TIME.exec(cell)
  if (!t) return ''
  let h = Number(t[1])
  const pm = t[3]?.toLowerCase()
  if (pm === 'pm' && h < 12) h += 12
  if (pm === 'am' && h === 12) h = 0
  return `${pad(h)}:${t[2]}`
}

/** One cell in a known format, or null when it is not a date in that format. */
export function parseDate(cell: string, format: DateFormat): ParsedDate | null {
  const s = cell.trim()
  if (!s) return null
  if (format === 'serial' || format === 'unix') {
    const n = Number(s.replace(',', '.'))
    if (!Number.isFinite(n)) return null
    if (format === 'unix') return fromEpoch(n > 1e11 ? n : n * 1000)
    if (!(n > 0 && n < 100_000)) return null
    // A serial is a calendar day plus a fraction of it, with no time zone: read it in UTC.
    const d = new Date(Math.round((n - EXCEL_EPOCH) * 86_400_000))
    return {
      date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      time: n % 1 ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : '',
    }
  }
  const m = PARTS.exec(s)
  if (!m) return null
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const [y, mo, d] = format === 'ymd' ? [a, b, c] : format === 'dmy' ? [year(c), b, a] : [year(c), a, b]
  if (format === 'ymd' && m[1].length !== 4) return null
  if (!valid(y, mo, d)) return null
  return { date: `${y}-${pad(mo)}-${pad(d)}`, time: timeOf(s.slice(m[0].length)) }
}

/**
 * The format that reads every non-empty cell of a column, preferring year-first, then
 * day-first; `ambiguous` when month-first would read them all too (every day ≤ 12), so the user
 * is asked. Null when no format reads the column.
 */
export function guessDateFormat(cells: string[]): { format: DateFormat; ambiguous: boolean } | null {
  const filled = cells.map((c) => c.trim()).filter(Boolean)
  if (!filled.length) return null
  const reads = (f: DateFormat) => filled.every((c) => parseDate(c, f) !== null)
  if (filled.every((c) => /^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(c)) && reads('ymd'))
    return { format: 'ymd', ambiguous: false }
  const dmy = reads('dmy')
  const mdy = reads('mdy')
  if (dmy || mdy) return { format: dmy ? 'dmy' : 'mdy', ambiguous: dmy && mdy }
  if (filled.every((c) => /^\d{9,13}$/.test(c))) return { format: 'unix', ambiguous: false }
  if (filled.every((c) => /^\d{5}([.,]\d+)?$/.test(c)) && reads('serial'))
    return { format: 'serial', ambiguous: false }
  return null
}

/** A time-of-day cell ("08:30", "8:30 pm", "08:30:12"), or ''. */
export const parseTime = (cell: string): string => timeOf(` ${cell.trim()}`)
