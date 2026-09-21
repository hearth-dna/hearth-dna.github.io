import type { Dir } from '../backup/folder'
import { listNames, readFrom, subdir, writeTo } from '../backup/folder'
import { attachmentsDirName } from '../backup/naming'
import type { Database } from '../db/db'
import { attachmentShas } from '../db/repo'
import { sha256Hex } from '../import/unpack'
import { isEncrypted, opener, sealer } from './crypto'
import { attachmentBlobName } from './file'
import { missingSidecars, sidecarName } from './sidecar'

/**
 * The attached documents beside the snapshot (docs/architecture/storage/backup-folder.md).
 *
 * The snapshot carries only the rows: it is rewritten in full every few seconds and kept in three
 * rotations, so putting documents inside it would copy the whole pile four times over on every
 * edit. Instead each document is written once, under its own content hash, and left alone.
 */

/** Kept small so one automatic backup never sits on the folder for minutes. */
const MAX_FILES_PER_RUN = 25
const MAX_BYTES_PER_RUN = 100 * 1024 * 1024

export interface MirrorResult {
  written: number
  /** Documents this device has the row for but not the bytes, so it could not copy them. */
  skipped: number
  /** Still to write after this run's budget ran out; the next backup continues. */
  remaining: number
}

export async function mirrorAttachments(
  dir: Dir,
  db: Database,
  profile: string,
  passphrase: string | null,
): Promise<MirrorResult> {
  const wanted = await attachmentShas(db)
  if (wanted.length === 0) return { written: 0, skipped: 0, remaining: 0 }
  const sub = await subdir(dir, attachmentsDirName(profile), true)
  if (!sub) throw new Error('cannot open the attachments folder')
  const todo = missingSidecars(wanted, await listNames(sub))
  const seal = passphrase ? await sealer(passphrase) : null
  let written = 0
  let skipped = 0
  let bytes = 0
  let i = 0
  for (; i < todo.length; i++) {
    if (written >= MAX_FILES_PER_RUN || bytes >= MAX_BYTES_PER_RUN) break
    const plain = await db.fileGet(attachmentBlobName(todo[i]))
    if (!plain) {
      // Metadata restored on a device that never had the document; another one will copy it.
      skipped++
      continue
    }
    await writeTo(sub, sidecarName(todo[i]), seal ? await seal(plain) : plain)
    written++
    bytes += plain.length
  }
  return { written, skipped, remaining: todo.length - i }
}

export interface PullResult {
  pulled: number
  /** Rows whose document the folder does not have, or could not be trusted. */
  missing: number
}

/**
 * Fetches the documents this device is missing. Every file is hashed again before it is stored:
 * the name is a claim about the content, and a folder is something other programs can write to.
 */
export async function pullAttachments(
  dir: Dir,
  db: Database,
  profile: string,
  passphrase: string | null,
  onStep?: (done: number, total: number) => void,
): Promise<PullResult> {
  const shas = await attachmentShas(db)
  if (shas.length === 0) return { pulled: 0, missing: 0 }
  const have = new Set(await db.fileList())
  const todo = shas.filter((sha) => !have.has(attachmentBlobName(sha)))
  if (todo.length === 0) return { pulled: 0, missing: 0 }
  const sub = await subdir(dir, attachmentsDirName(profile))
  if (!sub) return { pulled: 0, missing: todo.length }
  const open = passphrase ? await opener(passphrase) : null
  let pulled = 0
  let missing = 0
  for (const [n, sha] of todo.entries()) {
    onStep?.(n, todo.length)
    const raw = await readFrom(sub, sidecarName(sha))
    if (!raw) {
      missing++
      continue
    }
    try {
      const plain = isEncrypted(raw) ? await open?.(raw) : raw
      if (!plain || (await sha256Hex(plain)) !== sha) throw new Error('does not match its name')
      await db.filePut(attachmentBlobName(sha), plain)
      pulled++
    } catch {
      missing++
    }
  }
  return { pulled, missing }
}
