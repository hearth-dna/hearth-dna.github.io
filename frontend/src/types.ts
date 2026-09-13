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
