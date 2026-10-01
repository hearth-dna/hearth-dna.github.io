/**
 * How much room attached documents may take. Genome files were a handful of big imports; a
 * document pile grows a few megabytes at a time and will find the end of the origin's quota, so
 * every write asks first (there is nothing else in the app that does).
 */

/** Soft ceiling for all attachments together, well under a typical origin quota. */
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Free space a write needs beyond the file itself: the SAH pool preallocates, the worker holds a
 * copy while writing, and hitting the real ceiling corrupts nothing but fails loudly mid-import.
 */
export const HEADROOM = 3

/** Warn the user from here on. */
export const NEAR_FULL = 0.8

export interface Estimate {
  quota?: number
  usage?: number
}

/**
 * Whether `bytes` more will fit. An estimate the browser will not give (Firefox, older WebViews)
 * is not a reason to refuse — the QuotaExceededError on write is the real defence.
 */
export function fits(e: Estimate | null, bytes: number): boolean {
  if (!e || e.quota === undefined || e.usage === undefined) return true
  return e.quota - e.usage > bytes * HEADROOM
}

/** Whether the app's own ceiling still has room for `bytes`. */
export const totalFits = (currentTotal: number, bytes: number) => currentTotal + bytes <= MAX_TOTAL_BYTES

/** What the settings line shows: how full the origin is, and whether to say so loudly. */
export function usageLine(e: Estimate | null): { pct: number; nearFull: boolean } | null {
  if (!e?.quota || e.usage === undefined) return null
  const pct = e.usage / e.quota
  return { pct, nearFull: pct >= NEAR_FULL }
}

export const megabytes = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10
