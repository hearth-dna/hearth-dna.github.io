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
 * or a symptom the person noticed themselves ("pain in both hands since morning").
 */
export type HealthKind = 'symptom' | 'lab' | 'imaging' | 'diagnosis' | 'medication' | 'letter' | 'other'

export const HEALTH_KIND_LABELS: Record<HealthKind, string> = {
  symptom: 'Symptom',
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

export interface HealthEntry {
  id: string
  personId: string
  date: string // YYYY-MM-DD, the document's date, not the import date
  kind: HealthKind
  title: string
  body: string
  /** '' when typed by hand; 'gemini:<model>:<sha256 of the file>' when transcribed by a model. */
  source: string
  /** Where on the body, free text ('' when not applicable). Filterable. */
  bodyPart: string
  /** 1 (barely noticeable) to 10 (worst imaginable); null when not rated. */
  severity: number | null
  /** Conditions, diseases or free labels this entry relates to, e.g. ['arthritis', 'flare']. */
  tags: string[]
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
