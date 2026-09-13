import { HEALTH_KIND_LABELS, type HealthKind } from '../types'

/**
 * What a document reader returns and what the health-log form is prefilled with. The user reviews
 * and edits it before anything is saved; the model's output is never stored unseen.
 */
export interface HealthDraft {
  date: string
  kind: HealthKind
  title: string
  body: string
}

export const DOCUMENT_HINTS = ['auto', 'lab', 'imaging', 'letter', 'medication', 'diagnosis'] as const
export type DocumentHint = (typeof DOCUMENT_HINTS)[number]

/** Instruction sent with the pages. Transcription only: no interpretation, no advice. */
export function documentPrompt(hint: DocumentHint): string {
  const what = hint === 'auto' ? 'a medical document' : `a ${HEALTH_KIND_LABELS[hint].toLowerCase()}`
  return [
    `The attached pages are ${what} belonging to the user. Transcribe it faithfully into the JSON schema.`,
    'date: the document date in YYYY-MM-DD, or "" if not printed. kind: one of lab, imaging, letter, medication, diagnosis, other.',
    'title: a short label (test panel, modality and body region, or letter subject).',
    "body: the findings and conclusion in the document's own words, translated to English if needed, preserving the original wording of the conclusion. Do not add interpretation, risk statements or advice.",
    'values: every measured value as {name, value, unit, ref} for lab sheets; empty otherwise. Keep names as printed.',
    'Leave out patient name, date of birth, address, insurance and record numbers.',
  ].join(' ')
}

/** Gemini `responseSchema` (OpenAPI subset). */
export const DOCUMENT_SCHEMA = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    kind: { type: 'string', enum: ['lab', 'imaging', 'letter', 'medication', 'diagnosis', 'other'] },
    title: { type: 'string' },
    body: { type: 'string' },
    values: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
          unit: { type: 'string' },
          ref: { type: 'string' },
        },
        required: ['name', 'value'],
      },
    },
  },
  required: ['date', 'kind', 'title', 'body', 'values'],
}

const KINDS = new Set(Object.keys(HEALTH_KIND_LABELS))

/** Parses the model's JSON into a draft; tolerant of missing fields, strict about the kind. */
export function draftFromJson(text: string, fallbackDate: string): HealthDraft {
  const j = JSON.parse(text) as Partial<{
    date: string
    kind: string
    title: string
    body: string
    values: { name: string; value: string; unit?: string; ref?: string }[]
  }>
  const values = (j.values ?? [])
    .filter((v) => v?.name && v.value !== undefined)
    .map((v) => `${v.name}: ${v.value}${v.unit ? ` ${v.unit}` : ''}${v.ref ? ` (ref ${v.ref})` : ''}`)
  const body = [j.body?.trim() ?? '', values.join('\n')].filter(Boolean).join('\n\n')
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(j.date ?? '') ? (j.date as string) : fallbackDate,
    kind: KINDS.has(j.kind ?? '') ? (j.kind as HealthKind) : 'other',
    title: j.title?.trim() || 'Untitled document',
    body,
  }
}
