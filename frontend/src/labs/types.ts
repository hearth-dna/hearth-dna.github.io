/**
 * The lab catalogue (`kb/reviewed/labs/`) and the shape every lab report is read into, whatever
 * it came from: pasted text, a text PDF read locally, or a photo or scan read by Gemini. The
 * document reader fills `LabReportDraft`; the user reviews it; each included row becomes one
 * `lab` entry in the health log.
 */

export interface KbAnalyte {
  id: string
  names: Record<string, string>
  synonyms?: Record<string, string[]>
  /** As printed on reports (HGB, NEUT%, АЛТ); matched exactly, case-insensitively. */
  abbreviations?: string[]
  loinc?: string[]
  panels: string[]
  specimen: string[]
  /** Canonical unit, a `KbUnit` id. */
  unit: string
  /** Other accepted units → factor into the canonical unit; null = accepted, no exact conversion. */
  units: Record<string, number | null>
  /** Values outside this (canonical unit) are a slip, not a result. Not a reference range. */
  plausible: [number, number]
  decimals: number
  /** A named non-linear conversion (`CONVERSIONS` in normalise.ts). */
  convert?: string
}

export interface KbPanel {
  id: string
  names: Record<string, string>
  synonyms?: Record<string, string[]>
}

export interface KbUnit {
  id: string
  /** Printed spellings, compared after `unitKey` normalisation. */
  aliases: string[]
}

export type LabIssue = 'unknownAnalyte' | 'unknownUnit' | 'implausible' | 'unitMismatch'

/** One printed result, as a reader (local parser or model) found it. All strings, as printed. */
export interface RawLabRow {
  name: string
  value: string
  unit?: string
  ref?: string
  flag?: string
  /** A reader's guess at the catalogue id (the model's enum pick); checked, never trusted. */
  analyte?: string
  /** The heading it was printed under, if any. */
  section?: string
}

export interface LabRow {
  printedName: string
  printedValue: string
  printedUnit: string
  printedRef: string
  printedFlag: string
  section: string
  /** Catalogue id, or null when the test was not recognised. */
  analyte: string | null
  value: number | null
  comparator: '' | '<' | '>' | '<=' | '>='
  /** A qualitative result ("negative", "не обнаружено"); '' for a number. */
  text: string
  /** The printed unit's canonical spelling (a `KbUnit` id), or '' when unknown. */
  unit: string
  /** Reference range as printed, in the printed unit. */
  refLow: number | null
  refHigh: number | null
  flag: '' | 'H' | 'L'
  /** The value in the analyte's canonical unit, for trends and plausibility; null if unknown. */
  canonical: { value: number; unit: string } | null
  issues: LabIssue[]
}

export interface LabReportDraft {
  /** YYYY-MM-DD, '' when not printed. */
  date: string
  /** HH:MM, '' when not printed. */
  time: string
  /** A panel id when the report is one panel, else ''. */
  panel: string
  rows: LabRow[]
}
