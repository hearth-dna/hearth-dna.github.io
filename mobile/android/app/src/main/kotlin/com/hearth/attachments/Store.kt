package com.hearth.attachments

import com.hearth.data.Attachment
import com.hearth.data.Repo
import com.hearth.genome.sha256Hex

/** Why a file was refused; the message key and its placeholders are the caller's business. */
class AttachmentException(val reason: Rejection) : Exception(reason.name)

/**
 * Keeps one original document with an entry (attachments/store.ts). The file is written before the
 * row, so a failure half way leaves an unreferenced file the next prune collects rather than a row
 * pointing at nothing. Identical content writes identical bytes under the same name.
 */
fun addAttachment(repo: Repo, healthLogId: String, personId: String, bytes: ByteArray, name: String, already: Int): Attachment {
    val mime = sniffMime(bytes)
    checkFile(bytes.size.toLong(), mime, already)?.let { throw AttachmentException(it) }
    if (repo.attachmentBytesTotal() + bytes.size > MAX_TOTAL_BYTES) throw AttachmentException(Rejection.SPACE)
    val sha = sha256Hex(bytes)
    val a = Attachment(Repo.newId(), healthLogId, personId, sha, mime!!, bytes.size.toLong(), safeDisplayName(name), Repo.now())
    repo.blobs.put(Repo.attachmentBlobName(sha), bytes)
    repo.insertAttachment(a)
    return a
}

/** The bytes behind a row, or null when this phone only has the metadata (restored from a backup). */
fun attachmentBytes(repo: Repo, a: Attachment): ByteArray? = repo.blobs.get(Repo.attachmentBlobName(a.sha256))
