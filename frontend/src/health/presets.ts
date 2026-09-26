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
  /** Other names a spreadsheet or device export uses for this measurement (CSV import). */
  synonyms?: string[]
  /** Other spellings of `unit` itself ("кг" for kg). */
  unitAliases?: string[]
  /** Other units → conversion into `unit`, keyed by lower-case spelling (CSV import). */
  units?: Record<string, (v: number) => number>
}

const times = (f: number) => (v: number) => v * f
const LB = times(0.45359237)
const INCH = times(2.54)
const LENGTH = {
  in: INCH,
  inch: INCH,
  inches: INCH,
  '"': INCH,
  дюйм: INCH,
  m: times(100),
  mm: times(0.1),
  мм: times(0.1),
  м: times(100),
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
  m('temperature', 'Body temperature', '°C', 0.1, {
    synonyms: ['temperature', 'temp', 'body temp', 'температура', 't°'],
    unitAliases: ['c', '°с', 'с', 'celsius', 'degc', 'градусы'],
    units: {
      '°f': (v) => ((v - 32) * 5) / 9,
      f: (v) => ((v - 32) * 5) / 9,
      fahrenheit: (v) => ((v - 32) * 5) / 9,
      degf: (v) => ((v - 32) * 5) / 9,
    },
  }),
  m('blood-pressure', 'Blood pressure', 'mmHg', 1, {
    pair: ['systolic', 'diastolic'],
    bodyPart: 'heart',
    synonyms: ['bp', 'давление', 'артериальное давление'],
    unitAliases: ['mm hg', 'мм рт. ст.', 'мм рт.ст.', 'мм рт ст'],
  }),
  m('heart-rate', 'Heart rate', 'bpm', 1, {
    bodyPart: 'heart',
    synonyms: ['pulse', 'hr', 'resting heart rate', 'пульс', 'чсс'],
    unitAliases: ['beats/min', '/min', 'уд/мин', 'уд./мин', 'count/min'],
  }),
  m('spo2', 'Blood oxygen (SpO₂)', '%', 1, {
    bodyPart: 'lungs',
    synonyms: ['spo2', 'oxygen saturation', 'blood oxygen', 'сатурация'],
  }),
  m('weight', 'Weight', 'kg', 0.1, {
    synonyms: ['body mass', 'body weight', 'mass', 'вес', 'масса тела', 'масса'],
    unitAliases: ['кг', 'kilograms', 'kgs'],
    units: {
      lb: LB,
      lbs: LB,
      pound: LB,
      pounds: LB,
      фунт: LB,
      st: times(6.35029318),
      stone: times(6.35029318),
      g: times(0.001),
      г: times(0.001),
    },
  }),
  m('height', 'Height', 'cm', 0.5, {
    synonyms: ['body height', 'length', 'stature', 'рост', 'длина тела'],
    unitAliases: ['см'],
    units: { ...LENGTH, ft: times(30.48) },
  }),
  m('glucose', 'Blood glucose', 'mmol/L', 0.1, {
    synonyms: ['glucose', 'blood sugar', 'sugar', 'сахар', 'глюкоза', 'сахар крови'],
    unitAliases: ['mmol/l', 'ммоль/л'],
    units: { 'mg/dl': times(0.0555), 'мг/дл': times(0.0555) },
  }),
  m('sleep', 'Sleep', 'h', 0.25, {
    synonyms: ['sleep duration', 'time asleep', 'сон'],
    unitAliases: ['hr', 'hours', 'ч', 'час', 'часы'],
    units: { min: times(1 / 60), minutes: times(1 / 60), мин: times(1 / 60) },
  }),
  m('peak-flow', 'Peak flow', 'L/min', 5, { bodyPart: 'lungs' }),
  m('respiratory-rate', 'Breathing rate', 'breaths/min', 1, { bodyPart: 'lungs' }),
  m('waist', 'Waist circumference', 'cm', 0.5, {
    bodyPart: 'abdomen',
    synonyms: ['waist', 'талия', 'обхват талии'],
    unitAliases: ['см'],
    units: LENGTH,
  }),
  m('hip', 'Hip circumference', 'cm', 0.5, {
    bodyPart: 'hips',
    synonyms: ['hips', 'hip', 'бедра', 'обхват бедер'],
    unitAliases: ['см'],
    units: LENGTH,
  }),
  m('body-fat', 'Body fat', '%', 0.1, { synonyms: ['body fat percentage', 'fat', 'жир', 'процент жира'] }),
  m('muscle-mass', 'Muscle mass', '%', 0.1),
  m('head-circumference', 'Head circumference', 'cm', 0.5, {
    bodyPart: 'head',
    synonyms: ['head', 'окружность головы'],
    unitAliases: ['см'],
    units: LENGTH,
  }),
  m('steps', 'Steps', 'steps', 100, {
    synonyms: ['step count', 'шаги'],
    unitAliases: ['count', 'шаг', 'шагов'],
  }),
  m('water', 'Water drunk', 'L', 0.1, {
    synonyms: ['water', 'dietary water', 'вода'],
    unitAliases: ['l', 'л', 'litre', 'liter'],
    units: { ml: times(0.001), мл: times(0.001), 'fl oz': times(0.0295735), floz: times(0.0295735) },
  }),
  m('mood', 'Mood', '/10', 1, { synonyms: ['настроение'] }),
  m('stress', 'Stress', '/10', 1, { synonyms: ['стресс'] }),
  m('inr', 'INR (blood clotting)', 'ratio', 0.1),
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

/** The measurement preset a saved entry was made from, by its title. */
export const measurementPreset = (title: string): HealthPreset | undefined =>
  MEASUREMENT_PRESETS.find((x) => x.title.toLowerCase() === title.trim().toLowerCase())

/**
 * Measurement presets ordered for the quick bar: the ones this person has recorded before come
 * first, most recently used first, then the rest in list order. `entries` must be newest first.
 */
export function measurementOrder(entries: { kind: string; title: string }[]): HealthPreset[] {
  const used: HealthPreset[] = []
  for (const e of entries) {
    if (e.kind !== 'measurement') continue
    const p = measurementPreset(e.title)
    if (p && !used.includes(p)) used.push(p)
  }
  return [...used, ...MEASUREMENT_PRESETS.filter((p) => !used.includes(p))]
}

/** Presets that start an entry of this kind, in list order, for the chips above the form. */
export function presetsFor(kind: HealthKind): HealthPreset[] {
  return PRESET_GROUPS.flatMap((g) => g.presets).filter((p) => p.kind === kind)
}
