import type { HealthKind } from '../types'
import synonyms from './synonyms.json'

/**
 * Other names for each symptom preset, by id: what a person types or a document says for the
 * same symptom in English, Russian, Ukrainian, German, Spanish and French. The UI name in every
 * language comes from the locale files (`preset.<id>`). Lower case; matching ignores case anyway.
 */
const SYNONYMS: Record<string, string[]> = synonyms

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
  /** Symptoms and procedures: the structured details worth recording (stool form, which teeth…). */
  details?: DetailField[]
}

/**
 * One structured detail of a symptom, stored in the entry's `details` under its id. Option ids are
 * plain English words, so the stored data and an export read without the app.
 */
export type DetailField =
  /** A whole number on a fixed scale, e.g. the Bristol stool form 1–7. Chartable. */
  | { id: string; kind: 'scale'; min: number; max: number }
  /** How many times (per day). Chartable. */
  | { id: string; kind: 'count' }
  | { id: string; kind: 'choice'; options: string[] }
  /** Present or not; stored only when present. */
  | { id: string; kind: 'flag' }
  /**
   * Which teeth, picked on a tooth chart and stored as FDI numbers (health/teeth.ts); milk teeth
   * have their own numbers. `milk`: the chart opens on the milk teeth (teething).
   */
  | { id: string; kind: 'teeth'; milk?: true }

export type DetailValue = number | string | true

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
const s = (
  id: string,
  title: string,
  bodyPart = '',
  tags: string[] = [],
  details?: DetailField[],
): HealthPreset => ({
  id,
  title,
  kind: 'symptom',
  bodyPart,
  tags,
  synonyms: SYNONYMS[id],
  ...(details ? { details } : {}),
})
const proc = (
  id: string,
  title: string,
  bodyPart = '',
  tags: string[] = [],
  details?: DetailField[],
): HealthPreset => ({
  id,
  title,
  kind: 'procedure',
  bodyPart,
  tags,
  synonyms: SYNONYMS[id],
  ...(details ? { details } : {}),
})
const choice = (id: string, options: string[]): DetailField => ({ id, kind: 'choice', options })
const flag = (id: string): DetailField => ({ id, kind: 'flag' })
const TIMES: DetailField = { id: 'times', kind: 'count' }
const TEETH: DetailField = { id: 'teeth', kind: 'teeth' }
const TOOTH_TRIGGER = choice('trigger', ['cold', 'hot', 'sweet', 'biting', 'none'])

export const MEASUREMENT_PRESETS: HealthPreset[] = [
  // Where it is taken at home most often; a person who uses another place gets theirs (defaultBodyPart).
  m('temperature', 'Body temperature', '°C', 0.1, {
    bodyPart: 'armpit',
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
  s(
    'runny-nose',
    'Runny or blocked nose',
    'nose',
    [],
    [
      choice('nose', ['runny', 'blocked', 'both']),
      choice('discharge', ['clear', 'white', 'yellow', 'green', 'bloody']),
    ],
  ),
  s('sneezing', 'Sneezing', 'nose', ['allergy']),
  s('loss-of-smell', 'Loss of smell or taste', 'nose'),
  s('sore-throat', 'Sore throat', 'throat'),
  s('hoarse-voice', 'Hoarse voice', 'throat'),
  s(
    'cough',
    'Cough',
    'lungs',
    [],
    [
      choice('type', ['dry', 'wet']),
      choice('sputum', ['none', 'clear', 'white', 'yellow', 'green', 'brown', 'blood-streaked']),
    ],
  ),
  s(
    'phlegm',
    'Phlegm or sputum',
    'lungs',
    [],
    [choice('sputum', ['clear', 'white', 'yellow', 'green', 'brown', 'blood-streaked'])],
  ),
  s('wheezing', 'Wheezing', 'lungs'),
  s('shortness-of-breath', 'Shortness of breath', 'lungs'),
  s('chest-pain', 'Chest pain', 'chest'),
  s('palpitations', 'Palpitations', 'heart'),
  s('nausea', 'Nausea', 'stomach'),
  s('vomiting', 'Vomiting', 'stomach', [], [TIMES]),
  s(
    'stool',
    'Stool',
    'abdomen',
    [],
    [
      { id: 'bristol', kind: 'scale', min: 1, max: 7 },
      choice('colour', ['brown', 'yellow', 'green', 'black', 'red', 'pale']),
      flag('blood'),
      flag('mucus'),
    ],
  ),
  s('diarrhea', 'Diarrhea', 'abdomen', [], [TIMES]),
  s('constipation', 'Constipation', 'abdomen'),
  s('bloating', 'Bloating', 'abdomen'),
  s('gas', 'Wind or gas', 'abdomen'),
  s('stomach-ache', 'Stomach ache', 'stomach'),
  s('loss-of-appetite', 'Loss of appetite', 'stomach'),
  s('heartburn', 'Heartburn', 'chest'),
  s(
    'urination',
    'Urination problems',
    'abdomen',
    [],
    [
      choice('issue', ['frequent', 'painful', 'urgent', 'leaking']),
      choice('colour', ['pale', 'yellow', 'dark', 'red', 'cloudy']),
    ],
  ),
  s('thirst', 'Excessive thirst', 'whole body'),
  s('dry-mouth', 'Dry mouth', 'mouth'),
  s('back-pain', 'Back pain', 'back'),
  s('joint-pain', 'Joint pain', 'joints'),
  s('muscle-pain', 'Muscle pain', 'muscles'),
  s('leg-cramps', 'Leg cramps', 'legs'),
  s('rash', 'Rash', 'skin'),
  s('hives', 'Hives', 'skin', ['allergy']),
  s('itching', 'Itching', 'skin'),
  s('bruising', 'Bruising', 'skin'),
  s('cold-sore', 'Cold sore', 'mouth'),
  s('hair-loss', 'Hair loss', 'head'),
  // The id predates the wider name; kept so older entries still match their preset.
  s(
    'eye-irritation',
    'Red or irritated eyes',
    'eyes',
    [],
    [choice('discharge', ['none', 'watery', 'sticky']), flag('itchy')],
  ),
  s('watery-eyes', 'Watery eyes', 'eyes'),
  s('earache', 'Earache', 'ears'),
  s('blocked-ears', 'Blocked ears', 'ears'),
  s('toothache', 'Toothache', 'mouth', ['dental'], [TEETH, TOOTH_TRIGGER]),
  s('tooth-sensitivity', 'Sensitive teeth', 'mouth', ['dental'], [TEETH, TOOTH_TRIGGER]),
  s('bleeding-gums', 'Bleeding gums', 'mouth', ['dental'], [TEETH]),
  s('swollen-gums', 'Swollen gums', 'mouth', ['dental'], [TEETH]),
  s('loose-tooth', 'Loose tooth', 'mouth', ['dental'], [TEETH]),
  s('broken-tooth', 'Chipped or broken tooth', 'mouth', ['dental'], [TEETH]),
  s('tooth-came-out', 'Tooth came out', 'mouth', ['dental'], [TEETH]),
  s('teething', 'Teething', 'mouth', ['dental'], [{ id: 'teeth', kind: 'teeth', milk: true }]),
  s('insomnia', 'Trouble sleeping', ''),
  s('anxiety', 'Anxiety', ''),
  s('low-mood', 'Low mood', ''),
  s('period-pain', 'Period pain', 'abdomen'),
  s('night-sweats', 'Night sweats', 'whole body'),
  s('hot-flushes', 'Hot flushes', 'whole body'),
  s('swelling', 'Swelling', ''),
  s('numbness', 'Numbness or tingling', ''),
  s('blurred-vision', 'Blurred vision', 'eyes'),
  s('cold-intolerance', 'Always feeling cold', 'whole body'),
  s('confusion', 'Confusion', 'head'),
  s('difficulty-swallowing', 'Difficulty swallowing', 'throat'),
  s('memory-loss', 'Forgetfulness', 'head'),
  s('mole-change', 'New or changing mole', 'skin'),
  s('stiffness', 'Stiffness', 'joints'),
  s('cramps', 'Muscle cramps', 'muscles'),
  s('tinnitus', 'Ringing in the ears', 'ears'),
]

/** Treatments and checkups done to the person: what happened, not how they felt. */
export const PROCEDURE_PRESETS: HealthPreset[] = [
  proc('teeth-cleaning', 'Teeth cleaning', 'mouth', ['dental']),
  proc('dental-checkup', 'Dental checkup', 'mouth', ['dental']),
  proc('dental-filling', 'Dental filling', 'mouth', ['dental'], [TEETH]),
  proc('tooth-extraction', 'Tooth extraction', 'mouth', ['dental'], [TEETH]),
  proc('root-canal', 'Root canal treatment', 'mouth', ['dental'], [TEETH]),
  proc('dental-crown', 'Dental crown', 'mouth', ['dental'], [TEETH]),
  proc('dental-xray', 'Dental X-ray', 'mouth', ['dental'], [TEETH]),
  proc('fissure-sealant', 'Fissure sealant', 'mouth', ['dental'], [TEETH]),
  proc('checkup', 'General checkup'),
  proc('eye-exam', 'Eye exam', 'eyes'),
  proc('hearing-test', 'Hearing test', 'ears'),
  proc('ear-cleaning', 'Ear wax removal', 'ears'),
  proc('skin-check', 'Skin check', 'skin'),
  proc('blood-test', 'Blood test'),
  proc('ecg', 'ECG', 'heart'),
  proc('mammogram', 'Mammogram', 'chest', ['screening']),
  proc('pap-smear', 'Cervical screening (Pap smear)', '', ['screening']),
  proc('colonoscopy', 'Colonoscopy', 'abdomen', ['screening']),
  proc('physiotherapy', 'Physiotherapy session'),
  proc('massage', 'Massage', 'muscles'),
  proc('blood-donation', 'Blood donation'),
]

export const EVENT_PRESETS: HealthPreset[] = [
  { id: 'took-medication', title: 'Took medication', kind: 'medication' },
  { id: 'vaccination', title: 'Vaccination', kind: 'medication', tags: ['vaccine'] },
  { id: 'doctor-visit', title: 'Doctor visit', kind: 'letter' },
  { id: 'injury', title: 'Injury', kind: 'symptom', tags: ['injury'], synonyms: SYNONYMS.injury },
  {
    id: 'allergic-reaction',
    title: 'Allergic reaction',
    kind: 'symptom',
    tags: ['allergy'],
    synonyms: SYNONYMS['allergic-reaction'],
  },
  { id: 'fainting', title: 'Fainting', kind: 'symptom', bodyPart: 'head', synonyms: SYNONYMS.fainting },
]

export const PRESET_GROUPS: { label: string; labelKey: string; presets: HealthPreset[] }[] = [
  { label: 'Measurements', labelKey: 'preset.group.measurements', presets: MEASUREMENT_PRESETS },
  { label: 'Symptoms', labelKey: 'preset.group.symptoms', presets: SYMPTOM_PRESETS },
  { label: 'Procedures', labelKey: 'preset.group.procedures', presets: PROCEDURE_PRESETS },
  { label: 'Events', labelKey: 'preset.group.events', presets: EVENT_PRESETS },
]

export function findPreset(id: string): HealthPreset | undefined {
  for (const g of PRESET_GROUPS) {
    const p = g.presets.find((x) => x.id === id)
    if (p) return p
  }
  return undefined
}

/** The symptom preset a saved entry was made from, by its title or a synonym (older titles included). */
export const symptomPreset = (title: string): HealthPreset | undefined => {
  const p = presetOf({ kind: 'symptom', title })
  return p && SYMPTOM_PRESETS.includes(p) ? p : undefined
}

/** The structured details a saved symptom or procedure has, from the preset it names; [] for none. */
export const detailFieldsOf = (e: { kind: string; title: string }): DetailField[] =>
  (e.kind === 'symptom' ? symptomPreset(e.title) : e.kind === 'procedure' ? presetOf(e) : undefined)
    ?.details ?? []

/** The lists a quick bar offers, by the kind of entry it saves. */
const QUICK: Record<'measurement' | 'symptom' | 'procedure', HealthPreset[]> = {
  measurement: MEASUREMENT_PRESETS,
  symptom: SYMPTOM_PRESETS,
  procedure: PROCEDURE_PRESETS,
}

/**
 * Presets of these kinds ordered for a quick bar: the ones this person has recorded before come
 * first, most recently used first, then the rest in list order. `entries` must be newest first.
 */
export function presetOrder(
  kinds: (keyof typeof QUICK)[],
  entries: { kind: string; title: string }[],
): HealthPreset[] {
  const list = kinds.flatMap((k) => QUICK[k])
  const used: HealthPreset[] = []
  for (const e of entries) {
    const p = presetOf(e)
    if (p && list.includes(p) && !used.includes(p)) used.push(p)
  }
  return [...used, ...list.filter((p) => !used.includes(p))]
}

/** Presets that start an entry of this kind, in list order, for the chips above the form. */
export function presetsFor(kind: HealthKind): HealthPreset[] {
  return PRESET_GROUPS.flatMap((g) => g.presets).filter((p) => p.kind === kind)
}

const loose = (x: string) =>
  x.normalize('NFKC').toLowerCase().replace(/[’ʼ]/g, "'").replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

const names = (p: HealthPreset, label: (p: HealthPreset) => string) =>
  [label(p), p.title, ...(p.synonyms ?? [])].map(loose)

/**
 * Presets whose shown name, English title or a synonym match what is being typed, for the quick
 * bars' search: names that start with it first, then names with a word that does, then names that
 * contain it, each group in `order`. Empty text matches everything.
 */
export function searchPresets(
  order: HealthPreset[],
  text: string,
  label: (p: HealthPreset) => string,
): HealthPreset[] {
  const q = loose(text)
  if (!q) return order
  const rank = (p: HealthPreset) => {
    const ns = names(p, label)
    if (ns.some((n) => n.startsWith(q))) return 0
    if (ns.some((n) => n.split(/[\s(/-]+/).some((w) => w.startsWith(q)))) return 1
    return ns.some((n) => n.includes(q)) ? 2 : 3
  }
  return order
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p)
}

/** The preset that typed text names exactly: its shown name, English title or a synonym. */
export function presetNamed(
  order: HealthPreset[],
  text: string,
  label: (p: HealthPreset) => string,
): HealthPreset | undefined {
  const q = loose(text)
  return q ? order.find((p) => names(p, label).includes(q)) : undefined
}

/**
 * The preset a saved entry names: one of the same kind whose title or a synonym equals the
 * entry's title. Entries keep the English title they were saved with ("Headache"), or whatever
 * name the person typed ("головная боль"); this is how both show up in the UI language.
 */
export function presetOf(e: { kind: string; title: string }): HealthPreset | undefined {
  const n = loose(e.title)
  return PRESET_GROUPS.flatMap((g) => g.presets).find(
    (p) => p.kind === e.kind && [p.title, ...(p.synonyms ?? [])].some((x) => loose(x) === n),
  )
}

/**
 * The body part a new entry from this preset starts with: where this person put most of their
 * earlier entries of it (the latest of equally used places), else the preset's own; '' for none.
 * `entries` must be the person's log, newest first.
 */
export function defaultBodyPart(
  p: HealthPreset,
  entries: { kind: string; title: string; bodyPart: string }[],
): string {
  const counts = new Map<string, number>()
  for (const e of entries)
    if (e.bodyPart && presetOf(e) === p) counts.set(e.bodyPart, (counts.get(e.bodyPart) ?? 0) + 1)
  let best = ''
  for (const [part, n] of counts) if (n > (counts.get(best) ?? 0)) best = part
  return best || (p.bodyPart ?? '')
}

/** An entry's title as the UI shows it: the preset's name in the UI language, else as saved. */
export function entryTitle(e: { kind: string; title: string }, t: (key: string) => string): string {
  const p = presetOf(e)
  return p ? t(`preset.${p.id}`) : e.title
}
