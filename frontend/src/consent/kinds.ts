/**
 * Every consent the app can ask for (docs/design.md §13.1). The `version` bumps when the text
 * changes; a record for an older version does not count. Copy-out is confirmed per use and is
 * therefore not stored as a standing consent — it lands in the sharing log instead.
 *
 * `title` and `statements` are i18n keys (`src/i18n/en/consent.json`); components render them
 * through `t()`.
 */
export type ConsentKind =
  | 'first_launch'
  | 'import_genome'
  | 'import_minor'
  | 'import_document'
  | 'tier3_byok'
  | 'read_document_byok'
  | 'backup_folder'

export interface ConsentText {
  kind: ConsentKind
  version: number
  /** i18n key of the heading. */
  title: string
  /** i18n keys of the statements, one checkbox each. */
  statements: string[]
}

function text(kind: ConsentKind, version: number, statements: number): ConsentText {
  return {
    kind,
    version,
    title: `consent.${kind}.title`,
    statements: Array.from({ length: statements }, (_, i) => `consent.${kind}.statement${i + 1}`),
  }
}

export const CONSENTS: Record<ConsentKind, ConsentText> = {
  first_launch: text('first_launch', 1, 4),
  import_genome: text('import_genome', 1, 3),
  import_minor: text('import_minor', 1, 2),
  import_document: text('import_document', 1, 1),
  tier3_byok: text('tier3_byok', 1, 3),
  read_document_byok: text('read_document_byok', 1, 3),
  backup_folder: text('backup_folder', 1, 3),
}
