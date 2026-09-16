import type { HealthKind } from '../types'

/**
 * Common situations offered as one-click starting points for a health-log entry. A preset only
 * prefills the form (kind, title, body part, tags, unit); the user can change anything or ignore
 * the list and type a custom entry. Measurements carry a unit and, for pairs like blood
 * pressure, a second value.
 */
export interface HealthPreset {
  id: string
  title: string
  kind: HealthKind
  bodyPart?: string
  tags?: string[]
  /** Measurements only. */
  unit?: string
  /** Measurements with two numbers (systolic/diastolic); labels shown next to each input. */
  pair?: [string, string]
  /** Input hints; no validation beyond "is a number". */
  step?: number
}

const m = (
  id: string,
  title: string,
  unit: string,
  step: number,
  extra: Partial<HealthPreset> = {},
): HealthPreset => ({
  id,
  title,
  kind: 'measurement',
  unit,
  step,
  ...extra,
})
const s = (id: string, title: string, bodyPart = '', tags: string[] = []): HealthPreset => ({
  id,
  title,
  kind: 'symptom',
  bodyPart,
  tags,
})

export const MEASUREMENT_PRESETS: HealthPreset[] = [
  m('temperature', 'Body temperature', '°C', 0.1),
  m('blood-pressure', 'Blood pressure', 'mmHg', 1, { pair: ['systolic', 'diastolic'], bodyPart: 'heart' }),
  m('heart-rate', 'Heart rate', 'bpm', 1, { bodyPart: 'heart' }),
  m('spo2', 'Blood oxygen (SpO₂)', '%', 1, { bodyPart: 'lungs' }),
  m('weight', 'Weight', 'kg', 0.1),
  m('height', 'Height', 'cm', 0.5),
  m('glucose', 'Blood glucose', 'mmol/L', 0.1),
  m('sleep', 'Sleep', 'h', 0.25),
  m('peak-flow', 'Peak flow', 'L/min', 5, { bodyPart: 'lungs' }),
  m('respiratory-rate', 'Breathing rate', 'breaths/min', 1, { bodyPart: 'lungs' }),
]

export const SYMPTOM_PRESETS: HealthPreset[] = [
  s('headache', 'Headache', 'head'),
  s('migraine', 'Migraine', 'head', ['migraine']),
  s('fever', 'Fever', 'whole body'),
  s('chills', 'Chills', 'whole body'),
  s('fatigue', 'Fatigue', 'whole body'),
  s('dizziness', 'Dizziness', 'head'),
  s('nosebleed', 'Nosebleed', 'nose'),
  s('runny-nose', 'Runny or blocked nose', 'nose'),
  s('sneezing', 'Sneezing', 'nose', ['allergy']),
  s('sore-throat', 'Sore throat', 'throat'),
  s('cough', 'Cough', 'lungs'),
  s('shortness-of-breath', 'Shortness of breath', 'lungs'),
  s('chest-pain', 'Chest pain', 'chest'),
  s('palpitations', 'Palpitations', 'heart'),
  s('nausea', 'Nausea', 'stomach'),
  s('vomiting', 'Vomiting', 'stomach'),
  s('diarrhea', 'Diarrhea', 'abdomen'),
  s('constipation', 'Constipation', 'abdomen'),
  s('stomach-ache', 'Stomach ache', 'stomach'),
  s('heartburn', 'Heartburn', 'chest'),
  s('back-pain', 'Back pain', 'back'),
  s('joint-pain', 'Joint pain', 'joints'),
  s('muscle-pain', 'Muscle pain', 'muscles'),
  s('rash', 'Rash', 'skin'),
  s('itching', 'Itching', 'skin'),
  s('eye-irritation', 'Eye irritation', 'eyes'),
  s('earache', 'Earache', 'ears'),
  s('toothache', 'Toothache', 'mouth'),
  s('insomnia', 'Trouble sleeping', ''),
  s('anxiety', 'Anxiety', ''),
  s('low-mood', 'Low mood', ''),
  s('period-pain', 'Period pain', 'abdomen'),
  s('swelling', 'Swelling', ''),
  s('numbness', 'Numbness or tingling', ''),
]

export const EVENT_PRESETS: HealthPreset[] = [
  { id: 'took-medication', title: 'Took medication', kind: 'medication' },
  { id: 'vaccination', title: 'Vaccination', kind: 'medication', tags: ['vaccine'] },
  { id: 'doctor-visit', title: 'Doctor visit', kind: 'letter' },
  { id: 'injury', title: 'Injury', kind: 'symptom', tags: ['injury'] },
  { id: 'allergic-reaction', title: 'Allergic reaction', kind: 'symptom', tags: ['allergy'] },
  { id: 'fainting', title: 'Fainting', kind: 'symptom', bodyPart: 'head' },
]

export const PRESET_GROUPS: { label: string; labelKey: string; presets: HealthPreset[] }[] = [
  { label: 'Measurements', labelKey: 'preset.group.measurements', presets: MEASUREMENT_PRESETS },
  { label: 'Symptoms', labelKey: 'preset.group.symptoms', presets: SYMPTOM_PRESETS },
  { label: 'Events', labelKey: 'preset.group.events', presets: EVENT_PRESETS },
]

export function findPreset(id: string): HealthPreset | undefined {
  for (const g of PRESET_GROUPS) {
    const p = g.presets.find((x) => x.id === id)
    if (p) return p
  }
  return undefined
}
