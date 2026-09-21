import { gzipSync, strToU8 } from 'fflate'
import type { Database } from '../db/db'
import { genomeBlobName, importCalls, pruneBlobs } from '../db/repo'
import type { Translate } from '../i18n/context'
import { PROVIDER_LABELS, type Provider } from '../types'
import { parseRawText } from './parseFile'
import { detectProvider } from './providers'
import { fileToText, sha256Hex } from './unpack'

export interface ImportProgress {
  msg: string
  pct: number
}

/** Unpack → parse → store one raw-data file for one person. Shared by the single and batch dialogs. */
export async function importGenomeFile(
  db: Database,
  personId: string,
  file: File,
  onProgress: (p: ImportProgress) => void,
  t: Translate,
  forced?: Provider,
): Promise<string> {
  onProgress({ msg: t('importFile.unpacking'), pct: 0 })
  const { text, innerName } = await fileToText(file)
  const sha256 = await sha256Hex(text)
  const provider = PROVIDER_LABELS[forced || detectProvider(text)]
  onProgress({ msg: t('importFile.parsingFile', { name: innerName, provider }), pct: 0 })
  const r = await parseRawText(
    text,
    (d, n) => onProgress({ msg: t('importFile.parsing'), pct: (d / n) * 50 }),
    forced,
  )
  if (r.calls.length === 0) throw new Error(t('importFile.noRows'))
  onProgress({ msg: t('importFile.storing', { n: r.calls.length.toLocaleString() }), pct: 50 })
  await importCalls(
    db,
    personId,
    { provider: r.provider, build: r.build, sha256, originalName: file.name },
    r.calls,
    (n) =>
      onProgress({
        msg: t('importFile.storingProgress', {
          n: n.toLocaleString(),
          total: r.calls.length.toLocaleString(),
        }),
        pct: 50 + (n / r.calls.length) * 50,
      }),
  )
  // The original text is kept, gzipped, so backups ship it instead of re-serialising every row.
  await db.filePut(genomeBlobName(sha256), gzipSync(strToU8(text)))
  await pruneBlobs(db)
  return t('importFile.summary', {
    n: r.calls.length.toLocaleString(),
    provider: PROVIDER_LABELS[r.provider],
    build: r.build,
    skipped: r.skipped.toLocaleString(),
  })
}

/** "AncestryDNA (1).txt" → label "ancestrydna-1", display name "AncestryDNA (1)". */
export function personFromFileName(name: string): { label: string; displayName: string } {
  const stem = name.replace(/\.(zip|gz|txt|csv|tsv|vcf)$/gi, '').replace(/\.(txt|csv|tsv|vcf)$/i, '')
  const label = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return { label: label || 'genome', displayName: stem || name }
}
