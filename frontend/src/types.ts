export type Provider =
  | 'ancestrydna'
  | '23andme'
  | 'myheritage'
  | 'familytreedna'
  | 'livingdna'
  | 'genotek-vcf'
  | 'generic'

export const PROVIDER_LABELS: Record<Provider, string> = {
  ancestrydna: 'AncestryDNA',
  '23andme': '23andMe',
  myheritage: 'MyHeritage',
  familytreedna: 'FamilyTreeDNA',
  livingdna: 'Living DNA',
  'genotek-vcf': 'Genotek (VCF)',
  generic: 'Generic rsid/chr/pos/genotype text',
}

/** One genotype call. Alleles are single characters on the forward strand; '-' or '0' = no call. */
export interface Call {
  rsid: string
  chromosome: string // '1'..'22', 'X', 'Y', 'MT', 'XY'
  position: number
  a1: string
  a2: string
}

export type Sex = 'male' | 'female' | 'unknown'

export interface Person {
  id: string
  label: string
  displayName: string
  sex: Sex
  birthYear: number | null
  notes: string
  createdAt: string
}

/**
 * One dated entry in a person's health log: a lab report, diagnosis, medication or letter as text,
 * a symptom the person noticed themselves ("pain in both hands since morning"), or a measurement
 * they took at home (temperature 37.8 °C, blood pressure 120/80 mmHg).
 */
export type HealthKind =
  | 'symptom'
  | 'measurement'
  | 'lab'
  | 'imaging'
  | 'diagnosis'
  | 'medication'
  | 'letter'
  | 'other'

export const HEALTH_KIND_LABELS: Record<HealthKind, string> = {
  symptom: 'Symptom',
  measurement: 'Measurement',
  lab: 'Lab result',
  imaging: 'Imaging report',
  diagnosis: 'Diagnosis',
  medication: 'Medication',
  letter: 'Doctor letter',
  other: 'Other',
}

/** Suggestions for the body-part field; free text is accepted too. */
export const BODY_PARTS = [
  'head',
  'eyes',
  'ears',
  'nose',
  'mouth',
  'throat',
  'neck',
  'chest',
  'heart',
  'lungs',
  'abdomen',
  'stomach',
  'back',
  'lower back',
  'hips',
  'shoulders',
  'arms',
  'elbows',
  'wrists',
  'hands',
  'fingers',
  'legs',
  'knees',
  'ankles',
  'feet',
  'skin',
  'joints',
  'muscles',
  'whole body',
] as const

/** Which side of a paired body part; '' when not applicable or not recorded. */
export const BODY_SIDES = ['left', 'right', 'both'] as const
export type BodySide = (typeof BODY_SIDES)[number] | ''

export interface HealthEntry {
  id: string
  personId: string
  date: string // YYYY-MM-DD, the document's date, not the import date
  /** HH:MM local time of day, '' when unknown (a lab report from paper) or not recorded. */
  time: string
  kind: HealthKind
  title: string
  body: string
  /** '' when typed by hand; 'gemini:<model>:<sha256 of the file>' when transcribed by a model. */
  source: string
  /** Where on the body, free text ('' when not applicable). Filterable. */
  bodyPart: string
  /** Left, right or both for a paired part (knees, hands…); '' otherwise. */
  side: BodySide
  /** 1 (barely noticeable) to 10 (worst imaginable); null when not rated. */
  severity: number | null
  /** Conditions, diseases or free labels this entry relates to, e.g. ['arthritis', 'flare']. */
  tags: string[]
  /** Measured number (temperature, weight, systolic pressure…); null for text-only entries. */
  value: number | null
  /** Second number of a pair, e.g. diastolic pressure; null otherwise. */
  value2: number | null
  /** Unit of `value`, e.g. '°C', 'mmHg'; '' when there is no value. */
  unit: string
  /** Lab catalogue id (`Kb.analytes`) of a lab result; '' for anything else. */
  analyte: string
  /** Reference range as printed on the report, in `unit`; null when none was printed. */
  refLow: number | null
  refHigh: number | null
  /** Out of range per the report (or its printed range): 'H', 'L', or ''. */
  flag: '' | 'H' | 'L'
  /** The result as printed when it is not a plain number ("<0.5", "negative"); '' otherwise. */
  valueText: string
  createdAt: string
}

export interface SourceFile {
  id: string
  personId: string
  provider: Provider
  build: string
  sha256: string
  originalName: string
  rowCount: number
  importedAt: string
}
