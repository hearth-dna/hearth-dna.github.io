import { gunzipSync, gzipSync, strFromU8, strToU8, unzipSync } from 'fflate'
import { isEncrypted, opener, sealer } from '../attachments/crypto'
import type { Database } from '../db/db'
import { type GenomeEntry, readHeader, sha256 } from '../export/container'
import type { Elsewhere, LoadGenome } from '../export/restore'
import type { GenomeFile } from '../export/snapshot'
import { sha256Hex } from '../import/unpack'
import type { Dir } from './folder'
import { genomesDirName } from './naming'

/**
 * A folder snapshot's genomes, kept beside it (`external_genomes`, docs/architecture/storage/
 * backup-folder.md). They are the bulk of a backup and change only on import, so each is written
 * once under its content hash and never again: a backup after an edit uploads the journal alone.
 * Encrypted like the attachment sidecars when there is a passphrase.
 */

/** `genomes/<sha256>.txt.gz` in the manifest is `<sha256>.txt.gz` in the genomes folder. */
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/**
 * Writes the genome files the folder does not have yet. Runs before the snapshot that names them,
 * so a snapshot in the folder never refers to a genome that is not there.
 */
export async function mirrorGenomes(
  dir: Dir,
  db: Database,
  profile: string,
  files: GenomeFile[],
  passphrase: string | null,
): Promise<number> {
  if (files.length === 0) return 0
  const sub = await dir.subdir(genomesDirName(profile), true)
  if (!sub) throw new Error('cannot open the genomes folder')
  const have = new Set(await sub.names())
  const todo = files.filter((f) => !have.has(fileName(f.path)))
  if (todo.length === 0) return 0
  const seal = passphrase ? await sealer(passphrase) : null
  for (const f of todo) {
    const bytes = await db.fileGet(f.blob)
    if (!bytes) throw new Error(`genome file ${f.blob} is missing from this device`)
    await sub.write(fileName(f.path), seal ? await seal(bytes) : bytes)
  }
  return todo.length
}

/** Reads genome files back for a restore; the restore checks each against the manifest. */
export async function genomeLoader(
  dir: Dir,
  profile: string,
  passphrase: string | null,
): Promise<LoadGenome> {
  const sub = await dir.subdir(genomesDirName(profile))
  if (!sub) return async () => null
  const open = passphrase ? await opener(passphrase) : null
  return async (entry: GenomeEntry) => {
    const raw = await sub.read(fileName(entry.path))
    if (!raw || !isEncrypted(raw)) return raw
    if (!open) throw new Error('the genome files in this folder are encrypted; enter the passphrase')
    return open(raw)
  }
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4

/**
 * Picked files with any .zip opened up: a whole backup folder compressed into one file (the Files
 * app's Compress, a cloud drive's folder download) is one selection on a phone. From a zip only
 * the current snapshots and the genome files are taken; rotated copies, conflict files, the README
 * and macOS metadata are left inside.
 */
export function expandArchives(
  files: { name: string; bytes: Uint8Array }[],
): { name: string; bytes: Uint8Array }[] {
  return files.flatMap((f) => {
    // A dump v2 is a zip too (plaintext ones): it is a backup, not a folder of them.
    if (!isZip(f.bytes) || readHeader(f.bytes)) return [f]
    const base = (n: string) => n.slice(n.lastIndexOf('/') + 1)
    const keep = (n: string) =>
      !n.endsWith('/') &&
      !n.includes('__MACOSX/') &&
      !base(n).startsWith('._') &&
      ((base(n).endsWith('.hearth') && !base(n).includes('.conflict-')) || base(n).endsWith('.gz'))
    const entries = unzipSync(f.bytes, { filter: (e) => keep(e.name) })
    return Object.entries(entries).map(([name, bytes]) => ({ name: base(name), bytes }))
  })
}

/** A picked file as a possible genome: its gzip bytes and both hashes a manifest may know it by. */
export interface PickedGenome {
  gz: Uint8Array
  /** sha256 of `gz` (the manifest entry's `sha256`, when the copy is byte for byte). */
  sha256: string
  /** sha256 of the text inside (an original's `source_file` hash). */
  textSha: string
}

const isGzip = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b

/**
 * Files the user picked by hand that may be genome files (a folder snapshot's `genomes`, picked on
 * a phone that loads the snapshot from a cloud drive). Sealed ones are opened with the passphrase.
 * A drive or phone may hand a `.gz` over already decompressed, so plain text counts too, and is
 * known by the hash of its text. `null` for a file sealed with another passphrase.
 */
export async function readPickedGenomes(
  files: Uint8Array[],
  passphrase: string | null,
): Promise<(PickedGenome | null)[]> {
  const open = passphrase ? await opener(passphrase) : null
  const out: (PickedGenome | null)[] = []
  for (const raw of files) {
    if (isEncrypted(raw) && !open) throw new Error('the genome files are encrypted; enter the passphrase')
    let bytes: Uint8Array
    try {
      bytes = isEncrypted(raw) && open ? await open(raw) : raw
    } catch {
      out.push(null)
      continue
    }
    let text: string
    try {
      text = strFromU8(isGzip(bytes) ? gunzipSync(bytes) : bytes)
    } catch {
      out.push(null) // a broken gzip
      continue
    }
    const gz = isGzip(bytes) ? bytes : gzipSync(strToU8(text))
    out.push({ gz, sha256: await sha256(isGzip(bytes) ? bytes : gz), textSha: await sha256Hex(text) })
  }
  return out
}

/** Which picked file is the genome `e` waits for: the same bytes, or the same text inside. */
export function pickFor(e: Elsewhere, picked: (PickedGenome | null)[]): number {
  return picked.findIndex(
    (p) => !!p && (p.sha256 === e.entry.sha256 || (!!e.textSha && p.textSha === e.textSha)),
  )
}
