import type { Database } from '../db/db'
import { importCalls } from '../db/repo'
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
  forced?: Provider,
): Promise<string> {
  onProgress({ msg: 'Unpacking…', pct: 0 })
  const { text, innerName } = await fileToText(file)
  const sha256 = await sha256Hex(text)
  onProgress({ msg: `Parsing ${innerName} (${PROVIDER_LABELS[forced || detectProvider(text)]})…`, pct: 0 })
  const r = await parseRawText(text, (d, t) => onProgress({ msg: 'Parsing…', pct: (d / t) * 50 }), forced)
  if (r.calls.length === 0) throw new Error('no genotype rows recognised — pick the provider manually')
  onProgress({ msg: `Storing ${r.calls.length.toLocaleString()} calls…`, pct: 50 })
  await importCalls(
    db,
    personId,
    { provider: r.provider, build: r.build, sha256, originalName: file.name },
    r.calls,
    (n) =>
      onProgress({
        msg: `Storing ${n.toLocaleString()} / ${r.calls.length.toLocaleString()}…`,
        pct: 50 + (n / r.calls.length) * 50,
      }),
  )
  return `${r.calls.length.toLocaleString()} calls from ${PROVIDER_LABELS[r.provider]} (build ${r.build}); ${r.skipped.toLocaleString()} no-calls skipped`
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
