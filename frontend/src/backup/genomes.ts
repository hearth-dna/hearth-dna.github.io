import { isEncrypted, opener, sealer } from '../attachments/crypto'
import type { Database } from '../db/db'
import { type GenomeEntry, sha256 } from '../export/container'
import type { LoadGenome } from '../export/restore'
import type { GenomeFile } from '../export/snapshot'
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

/**
 * Files the user picked by hand that may be genome files (a folder snapshot's `genomes`, picked
 * on a phone that loads the snapshot from a cloud drive), by content hash: whatever the drive
 * renamed a copy to, the hash finds its manifest entry. Sealed ones are opened with the
 * passphrase; a file that is not a genome simply matches nothing (`null` when it cannot be read).
 */
export async function openGenomeFiles(
  files: Uint8Array[],
  passphrase: string | null,
): Promise<{ byHash: Map<string, Uint8Array>; hashes: (string | null)[] }> {
  const open = passphrase ? await opener(passphrase) : null
  const byHash = new Map<string, Uint8Array>()
  const hashes: (string | null)[] = []
  for (const raw of files) {
    if (isEncrypted(raw) && !open) throw new Error('the genome files are encrypted; enter the passphrase')
    let gz: Uint8Array
    try {
      gz = isEncrypted(raw) && open ? await open(raw) : raw
    } catch {
      hashes.push(null) // sealed with another passphrase
      continue
    }
    const hash = await sha256(gz)
    byHash.set(hash, gz)
    hashes.push(hash)
  }
  return { byHash, hashes }
}
