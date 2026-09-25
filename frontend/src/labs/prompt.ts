import type { Kb } from '../kb/kb'
import { normaliseRow } from './normalise'
import type { LabReportDraft, RawLabRow } from './types'

/**
 * What a model is asked to return for a lab report, and how its reply becomes a draft. The model
 * transcribes each printed result and picks a catalogue id; it never converts, interprets or
 * judges. Every number goes through `normaliseRow` before the user sees it.
 */

const OTHER = 'other'

/** One line per test: `id: English name / abbreviations`, the list the model maps names onto. */
export function analyteList(kb: Kb): string {
  return kb.analytes
    .map((a) => {
      const abbr = a.abbreviations?.length ? ` / ${a.abbreviations.join(', ')}` : ''
      return `${a.id}: ${a.names.en}${abbr} [${a.unit}]`
    })
    .join('\n')
}

/** Gemini `responseSchema` (OpenAPI subset) with the catalogue ids as an enum. */
export function labSchema(kb: Kb): object {
  return {
    type: 'object',
    properties: {
      date: { type: 'string' },
      time: { type: 'string' },
      panel: { type: 'string', enum: [...kb.panels.map((p) => p.id), OTHER] },
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            printed_name: { type: 'string' },
            analyte: { type: 'string', enum: [...kb.analytes.map((a) => a.id), OTHER] },
            value: { type: 'string' },
            unit: { type: 'string' },
            ref: { type: 'string' },
            flag: { type: 'string' },
            section: { type: 'string' },
          },
          required: ['printed_name', 'analyte', 'value'],
        },
      },
    },
    required: ['date', 'results'],
  }
}

export function labPrompt(kb: Kb): string {
  return [
    'The attached pages are a blood test report belonging to the user. Transcribe every result into the JSON schema.',
    'date: the sample or report date in YYYY-MM-DD, "" if not printed. time: HH:MM if printed, else "".',
    'panel: the panel id when the whole report is one panel, else "other".',
    'For each result: printed_name, value, unit, ref (the reference range) and flag (H, L, arrows or stars) exactly as printed,',
    'in the original language, with the original decimal separator. Do not convert units, round, or fill in anything not printed.',
    'section: the heading the result is printed under, if any.',
    'analyte: the id from the list below that the printed test is, or "other" if none fits. Use the unit to tell a percentage',
    'from an absolute count (Neutrophils % vs Neutrophils 10^9/L).',
    'Leave out patient name, date of birth, address, insurance and record numbers. Do not add interpretation or advice.',
    '',
    'Tests (id: name / abbreviations [canonical unit]):',
    analyteList(kb),
  ].join('\n')
}

/** The model's reply → a draft; tolerant of missing fields, every row normalised locally. */
export function labDraftFromJson(kb: Kb, text: string): LabReportDraft {
  const j = JSON.parse(text) as Partial<{
    date: string
    time: string
    panel: string
    results: Partial<{
      printed_name: string
      analyte: string
      value: string
      unit: string
      ref: string
      flag: string
      section: string
    }>[]
  }>
  const rows = (j.results ?? [])
    .filter((r) => r?.printed_name && r.value !== undefined)
    .map(
      (r): RawLabRow => ({
        name: r.printed_name as string,
        value: String(r.value),
        unit: r.unit,
        ref: r.ref,
        flag: r.flag,
        section: r.section,
        analyte: r.analyte === OTHER ? undefined : r.analyte,
      }),
    )
    .map((r) => normaliseRow(kb, r))
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(j.date ?? '') ? (j.date as string) : '',
    time: /^\d{2}:\d{2}$/.test(j.time ?? '') ? (j.time as string) : '',
    panel: kb.panels.some((p) => p.id === j.panel) ? (j.panel as string) : '',
    rows,
  }
}
