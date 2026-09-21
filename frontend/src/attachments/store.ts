import type { Database } from '../db/db'
import {
  attachmentShas,
  countAttachments,
  deleteAttachment,
  getMeta,
  insertAttachment,
  newId,
  now,
  pruneBlobs,
  setMeta,
} from '../db/repo'
import { sha256Hex } from '../import/unpack'
import type { Attachment } from '../types'
import { attachmentBlobName, checkFile, type Rejection, safeDisplayName, sniffMime } from './file'
import { type Estimate, fits, totalFits } from './quota'

/**
 * Attaching, reading and removing the original documents kept with a health log entry. The bytes
 * go to the OPFS file cache beside the database (the same one the genome originals use); the row
 * holds only metadata. Nothing here touches the network.
 */

const META_PERSISTED = 'storage_persisted'

export class AttachmentError extends Error {
  constructor(readonly reason: Rejection | 'quota') {
    super(reason)
  }
}

async function estimate(): Promise<Estimate | null> {
  try {
    return (await navigator.storage?.estimate?.()) ?? null
  } catch {
    return null
  }
}

/**
 * Asks the browser to stop evicting this origin. Chrome grants it on engagement and refuses a
 * request made at startup, so this runs from the click that attaches the first document, once per
 * profile; the answer is only shown in Settings.
 */
export async function requestPersistence(db: Database): Promise<boolean> {
  const seen = await getMeta(db, META_PERSISTED)
  if (seen !== null) return seen === 'true'
  let granted = false
  try {
    granted = (await navigator.storage?.persist?.()) ?? false
  } catch {
    granted = false
  }
  await setMeta(db, META_PERSISTED, String(granted))
  return granted
}

export const persistedState = (db: Database) => getMeta(db, META_PERSISTED)

/**
 * Stores one file against an entry. The blob is written before the row, so a failure half way
 * leaves an unreferenced file the next prune collects rather than a row pointing at nothing.
 */
export async function addAttachment(
  db: Database,
  healthLogId: string,
  personId: string,
  file: File,
  already = 0,
): Promise<Attachment> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniffMime(bytes)
  const bad = checkFile(file, mime, already)
  if (bad || !mime) throw new AttachmentError(bad ?? 'type')
  const total = (await countAttachments(db)).bytes
  if (!totalFits(total, file.size) || !fits(await estimate(), file.size)) throw new AttachmentError('space')
  const sha256 = await sha256Hex(bytes)
  const a: Attachment = {
    id: newId(),
    healthLogId,
    personId,
    sha256,
    mime,
    bytes: bytes.length,
    name: safeDisplayName(file.name),
    createdAt: now(),
  }
  try {
    // Identical content writes identical bytes, so a duplicate is a harmless overwrite.
    await db.filePut(attachmentBlobName(sha256), bytes)
  } catch {
    throw new AttachmentError('quota')
  }
  await insertAttachment(db, a)
  return a
}

/** The bytes behind a row, or null when this device only has the metadata (see the mirror). */
export const attachmentBytes = (db: Database, a: Attachment) => db.fileGet(attachmentBlobName(a.sha256))

export async function removeAttachment(db: Database, id: string): Promise<void> {
  await deleteAttachment(db, id)
  await pruneBlobs(db)
}

/** Rows whose blob this device does not have: restored metadata waiting for the backup folder. */
export async function missingLocally(db: Database): Promise<string[]> {
  const shas = await attachmentShas(db)
  if (shas.length === 0) return []
  const have = new Set(await db.fileList())
  return shas.filter((sha) => !have.has(attachmentBlobName(sha)))
}
