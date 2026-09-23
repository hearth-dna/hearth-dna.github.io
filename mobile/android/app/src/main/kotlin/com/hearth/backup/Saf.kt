package com.hearth.backup

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import java.io.InputStream

/**
 * A place the system document picker granted (ADR 0008): a folder from `OpenDocumentTree`, or one
 * file from `CreateDocument` / `OpenDocument` where the provider offers no folders (Google Drive's
 * and Dropbox's own apps). What the app holds is a persisted grant on a content URI, nothing else.
 */
class SafDir(private val resolver: ContentResolver, private val tree: Uri, override val name: String, private val path: List<String> = emptyList()) : Dir {
    override val single = false
    override val versioned = false

    private class Child(val id: String, val name: String, val isDir: Boolean)

    private fun children(parent: String): List<Child> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent)
        val columns = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE)
        val out = mutableListOf<Child>()
        resolver.query(uri, columns, null, null, null)?.use {
            while (it.moveToNext()) out += Child(it.getString(0), it.getString(1) ?: "", it.getString(2) == Document.MIME_TYPE_DIR)
        }
        return out
    }

    /** The document id of this folder, or null when it is gone. */
    private fun here(): String? {
        var id = DocumentsContract.getTreeDocumentId(tree)
        for (segment in path) id = children(id).firstOrNull { it.name == segment && it.isDir }?.id ?: return null
        return id
    }

    private fun file(name: String, folders: Boolean = false): Uri? {
        val parent = here() ?: return null
        return children(parent).firstOrNull { it.name == safeName(name) && (folders || !it.isDir) }?.let { DocumentsContract.buildDocumentUriUsingTree(tree, it.id) }
    }

    override fun names(): List<String> = here()?.let { p -> children(p).map { it.name } } ?: emptyList()

    override fun read(name: String): ByteArray? = file(name)?.let { resolver.openInputStream(it)?.use(InputStream::readBytes) }

    override fun readHead(name: String, bytes: Int): ByteArray? = file(name)?.let { resolver.openInputStream(it)?.use { s -> readUpTo(s, bytes) } }

    override fun write(name: String, bytes: ByteArray) {
        val parent = here() ?: error("folder not found")
        val uri = file(name) ?: DocumentsContract.createDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, parent), MIME, safeName(name))
            ?: error("cannot create $name")
        writeTo(resolver, uri, bytes)
    }

    override fun remove(name: String) {
        file(name, folders = true)?.let { DocumentsContract.deleteDocument(resolver, it) }
    }

    override fun subdir(name: String, create: Boolean): Dir? {
        val parent = here() ?: return null
        val existing = children(parent).firstOrNull { it.name == safeName(name) }
        when {
            existing != null && !existing.isDir -> return null
            existing == null && !create -> return null
            existing == null -> DocumentsContract.createDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, parent), Document.MIME_TYPE_DIR, safeName(name))
                ?: return null
        }
        return SafDir(resolver, tree, name, path + name)
    }
}

/**
 * One picked file, seen as a place that holds the snapshot and nothing else. Any other name is
 * refused rather than mapped onto the file: a rotation or a README there would overwrite the backup.
 */
class SafFile(private val resolver: ContentResolver, private val uri: Uri, override val name: String, private val snapshot: String = SNAPSHOT) : Dir {
    override val single = true
    override val versioned = false

    private fun only(n: String) = require(n == snapshot) { "$name is a single file and holds only the snapshot" }

    override fun names() = listOf(snapshot)
    override fun read(name: String) = if (name == snapshot) runCatching { resolver.openInputStream(uri)?.use(InputStream::readBytes) }.getOrNull() else null
    override fun readHead(name: String, bytes: Int) = if (name == snapshot) runCatching { resolver.openInputStream(uri)?.use { readUpTo(it, bytes) } }.getOrNull() else null
    override fun write(name: String, bytes: ByteArray) {
        only(name)
        writeTo(resolver, uri, bytes)
    }
    override fun remove(name: String) {
        only(name)
        DocumentsContract.deleteDocument(resolver, uri)
    }
    override fun subdir(name: String, create: Boolean): Dir? = null
}

private const val MIME = "application/octet-stream"

/**
 * "wt" truncates; a provider that refuses it gets "w", which on everything current truncates too.
 * Closing is when a cloud provider commits the file, so a failure there is a failed write.
 */
private fun writeTo(resolver: ContentResolver, uri: Uri, bytes: ByteArray) {
    val out = runCatching { resolver.openOutputStream(uri, "wt") }.getOrNull() ?: resolver.openOutputStream(uri, "w") ?: error("cannot write the file")
    out.use { it.write(bytes) }
}

/** Up to [max] bytes from the start of the stream. */
fun readUpTo(stream: InputStream, max: Int): ByteArray {
    val buffer = ByteArray(max)
    var filled = 0
    while (filled < max) {
        val n = stream.read(buffer, filled, max - filled)
        if (n < 0) break
        filled += n
    }
    return if (filled == max) buffer else buffer.copyOf(filled)
}

/**
 * A name inside the picked folder. SAF names are display names, not paths, so this is not what
 * keeps the app inside the folder (the tree grant is), but a separator is never meant.
 */
fun safeName(name: String): String {
    require(name.isNotEmpty() && name != "." && name != ".." && '/' !in name && '\u0000' !in name) { "not a file name" }
    return name
}
