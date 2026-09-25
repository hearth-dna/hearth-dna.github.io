import type { Kb } from './kb'
import { tokenMatch, tokens } from './text'

/**
 * The condition catalogue (`kb/reviewed/conditions.json`): one id per condition that ties its DNA
 * markers to the health-log records that belong to it — names and synonyms in several languages,
 * ICD-10 codes, lab tests, measurement presets, symptoms and drugs. Pure.
 */
export interface KbLab {
  name: string
  loinc?: string
  synonyms?: string[]
}

export interface KbCondition {
  id: string
  /** `en` is always present; other languages fall back to it. */
  names: Record<string, string>
  synonyms?: Record<string, string[]>
  icd10: string[]
  category: string
  rsids: string[]
  labs: KbLab[]
  /** Preset ids from health/presets.ts. */
  measurements: string[]
  symptoms: string[]
  /** Values from BODY_PARTS. */
  body_parts: string[]
  drugs: string[]
  summary?: string
  sources?: string[]
  reviewed_at?: string
}

export const conditionById = (kb: Kb, id: string): KbCondition | undefined =>
  kb.conditions.find((c) => c.id === id)

export const conditionName = (c: KbCondition, lang = 'en'): string => c.names[lang] ?? c.names.en

/** The English name for an id, or the id itself when the kb does not know it. */
export const conditionLabel = (kb: Kb, id: string): string => {
  const c = conditionById(kb, id)
  return c ? conditionName(c) : id
}

/** Every name and synonym of the condition, in every language. */
export function conditionNames(c: KbCondition): string[] {
  return [...Object.values(c.names), ...Object.values(c.synonyms ?? {}).flat()]
}

/**
 * Phrases that point to the condition in free text: its names and synonyms, its lab tests and
 * its drugs. Symptoms and body parts are left out on purpose: "fatigue" or "joints" alone say too
 * little to suggest a diagnosis.
 */
function pointers(c: KbCondition): string[] {
  return [...conditionNames(c), ...c.labs.flatMap((l) => [l.name, ...(l.synonyms ?? [])]), ...c.drugs]
}

/** A phrase occurs in the text when each of its words matches a word of the text. */
function phraseIn(phrase: string, words: string[]): boolean {
  const need = tokens(phrase)
  return need.length > 0 && need.every((t) => words.some((w) => tokenMatch(t, w)))
}

/** Ids of the conditions a text (an entry's title, tags, body; a question) points to. */
export function matchConditions(kb: Kb, text: string): string[] {
  const words = tokens(text)
  if (!words.length) return []
  return kb.conditions.filter((c) => pointers(c).some((p) => phraseIn(p, words))).map((c) => c.id)
}
