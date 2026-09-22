package com.hearth

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.InputStream
import java.io.OutputStream
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject

/**
 * The backup place on Android: the system document picker, and file calls on what it returned
 * (docs/decisions/0008-cloud-backups-on-the-phones.md; the page's half is
 * `frontend/src/backup/native.ts`).
 *
 * The Storage Access Framework is how Google Drive, Dropbox, OneDrive and local storage all reach
 * other apps, and each provider's own app does the syncing. So this is file I/O on the device, with
 * no network code and no account in the shell. What the user picks is a grant, not a path: a
 * content URI the app keeps a persisted permission for, and nothing outside it.
 *
 * Two shapes, because providers differ. A folder (`ACTION_OPEN_DOCUMENT_TREE`) holds the snapshot,
 * its rotations and the attached documents, exactly as the desktop backup folder does. Google Drive
 * and Dropbox do not offer folders to other apps at all, only single documents, so the page can
 * also ask for one file (`ACTION_CREATE_DOCUMENT` / `ACTION_OPEN_DOCUMENT`) and keeps only the
 * snapshot in it.
 *
 * The channel is a web message listener, not a `@JavascriptInterface`: it is handed only to the
 * app's own origin, and it is asynchronous, so a provider that takes seconds to fetch a file never
 * blocks the page. Every file call runs in order on one background thread.
 */
class Files(private val activity: ComponentActivity) {
    private val resolver: ContentResolver = activity.contentResolver
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val reads = ConcurrentHashMap<String, InputStream>()
    private val writes = ConcurrentHashMap<String, OutputStream>()
    private val nextHandle = AtomicLong()

    /** The one picker that may be open, and who to answer when it closes. */
    private var picking: Pending? = null

    /** Cloud sign-in over the same channel (Cloud.kt); MainActivity feeds it the Dropbox redirect. */
    val cloud = Cloud(activity)

    /** The backup passphrase, kept across restarts (Secrets.kt). */
    private val secrets = Secrets(activity)

    // Registered at construction, which MainActivity does in onCreate, as the result API requires.
    private val openTree =
        activity.registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { picked(it, single = false) }
    private val createFile =
        activity.registerForActivityResult(ActivityResultContracts.CreateDocument(MIME)) { picked(it, single = true) }
    private val openFile =
        activity.registerForActivityResult(ActivityResultContracts.OpenDocument()) { picked(it, single = true) }

    /** False on a WebView too old for origin-restricted listeners; the page then shows no phone backup. */
    fun install(web: WebView): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        WebViewCompat.addWebMessageListener(web, CHANNEL, setOf(HearthWebView.ORIGIN)) { _, message, _, isMainFrame, reply ->
            if (isMainFrame) receive(message, reply)
        }
        return true
    }

    private fun receive(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        val request = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return
        val id = request.optLong("id")
        val answer: Done = { result ->
            reply.postMessage(
                result.fold({ success(id, it) }, { failure(id, it.message ?: it.javaClass.simpleName) }),
            )
        }
        // A malformed request answers with an error; it must never take the app down with it.
        try {
            route(id, request, reply, answer)
        } catch (e: Exception) {
            answer(Result.failure(e))
        }
    }

    /** Picker and cloud calls start here on the main thread; file calls go to the file thread. */
    private fun route(id: Long, request: JSONObject, reply: JavaScriptReplyProxy, answer: Done) {
        when (request.optString("op")) {
            "pick" -> return pick(id, request, reply)
            "cloudProviders" -> return answer(Result.success(cloud.providers()))
            "cloudSignIn" -> return cloud.signIn(request.optString("provider"), answer)
            "cloudToken" -> return cloud.token(
                request.optString("provider"),
                request.optString("account"),
                request.optString("stale").ifEmpty { null },
                answer,
            )
            "cloudSignOut" -> return cloud.signOut(request.optString("provider"), request.optString("account"), answer)
        }
        io.execute {
            val text = try {
                success(id, run(request))
            } catch (e: Exception) {
                failure(id, e.message ?: e.javaClass.simpleName)
            }
            main.post { reply.postMessage(text) }
        }
    }

    // ---- picking --------------------------------------------------------------------------------

    private fun pick(id: Long, request: JSONObject, reply: JavaScriptReplyProxy) {
        if (picking != null) return reply.postMessage(failure(id, "a picker is already open"))
        picking = Pending(id, reply)
        when (request.optString("mode")) {
            "folder" -> openTree.launch(null)
            "newFile" -> createFile.launch(request.optString("suggested").ifBlank { "hearth-backup.hearth" })
            "existingFile" -> openFile.launch(arrayOf("*/*"))
            else -> {
                picking = null
                reply.postMessage(failure(id, "unknown picker mode"))
            }
        }
    }

    /** The picker closed. A null uri is the user backing out, which is an answer, not an error. */
    private fun picked(uri: Uri?, single: Boolean) {
        val pending = picking ?: return
        picking = null
        if (uri == null) return pending.reply.postMessage(success(pending.id, JSONObject.NULL))
        io.execute {
            val answer = try {
                // Kept across restarts: without this the grant dies with the process, and the next
                // launch would find a backup place it can no longer open.
                resolver.takePersistableUriPermission(uri, READ_WRITE)
                success(
                    pending.id,
                    JSONObject().put("ref", uri.toString()).put("name", displayName(uri)).put("single", single),
                )
            } catch (_: SecurityException) {
                failure(pending.id, "this provider does not let other apps write here; pick another place")
            } catch (e: Exception) {
                failure(pending.id, e.message ?: e.javaClass.simpleName)
            }
            main.post { pending.reply.postMessage(answer) }
        }
    }

    private fun displayName(uri: Uri): String {
        val doc = if (DocumentsContract.isTreeUri(uri)) treeRoot(uri) else uri
        resolver.query(doc, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) return it.getString(0) ?: ""
        }
        return uri.lastPathSegment ?: ""
    }

    // ---- file calls -----------------------------------------------------------------------------

    private fun run(r: JSONObject): Any = when (r.getString("op")) {
        "status" -> {
            val ref = r.getString("ref")
            val uri = Uri.parse(ref)
            val granted = resolver.persistedUriPermissions.any {
                it.uri == uri && it.isReadPermission && it.isWritePermission
            }
            JSONObject().put("granted", granted).put("ref", ref)
        }
        "secretGet" -> secrets.get(r.getString("name")) ?: JSONObject.NULL
        "secretSet" -> secrets.set(r.getString("name"), r.getString("value")).let { JSONObject.NULL }
        "secretDelete" -> secrets.delete(r.getString("name")).let { JSONObject.NULL }
        "release" -> {
            runCatching { resolver.releasePersistableUriPermission(Uri.parse(r.getString("ref")), READ_WRITE) }
            JSONObject.NULL
        }
        "list" -> {
            val tree = Uri.parse(r.getString("ref"))
            val dir = walk(tree, path(r)) ?: throw IllegalStateException("folder not found")
            JSONArray(children(tree, dir).map { it.name })
        }
        "mkdir" -> {
            val tree = Uri.parse(r.getString("ref"))
            val parent = walk(tree, path(r)) ?: throw IllegalStateException("folder not found")
            val name = safeName(r.getString("name"))
            val existing = children(tree, parent).firstOrNull { it.name == name }
            when {
                existing != null -> existing.isDir
                !r.optBoolean("create") -> false
                else -> DocumentsContract.createDocument(
                    resolver,
                    DocumentsContract.buildDocumentUriUsingTree(tree, parent),
                    Document.MIME_TYPE_DIR,
                    name,
                ) != null
            }
        }
        "open" -> target(r, create = false)?.let(resolver::openInputStream)
            ?.let { stream -> handle().also { reads[it] = stream } }
            ?: JSONObject.NULL
        "chunk" -> {
            val handle = r.getString("handle")
            val stream = reads[handle] ?: throw IllegalStateException("no such read")
            val bytes = readChunk(stream, CHUNK_BYTES)
            if (bytes.isEmpty()) reads.remove(handle)?.close()
            Base64.getEncoder().encodeToString(bytes)
        }
        "create" -> {
            val uri = target(r, create = true) ?: throw IllegalStateException("cannot create the file")
            // "wt" truncates; a provider that refuses it gets "w", which on everything current
            // truncates too (Android 10's did not, and wrote over the start of the old file).
            val stream = runCatching { resolver.openOutputStream(uri, "wt") }.getOrNull()
                ?: resolver.openOutputStream(uri, "w")
                ?: throw IllegalStateException("cannot write the file")
            handle().also { writes[it] = stream }
        }
        "append" -> {
            val stream = writes[r.getString("handle")] ?: throw IllegalStateException("no such write")
            stream.write(Base64.getDecoder().decode(r.getString("data")))
            JSONObject.NULL
        }
        "close" -> {
            // Closing is when a cloud provider commits the file, so its failure is a failed write.
            // A read closed early (only a header was wanted) just lets go of its stream.
            val handle = r.getString("handle")
            reads.remove(handle)?.close()
            writes.remove(handle)?.close()
            JSONObject.NULL
        }
        "remove" -> {
            // A folder too (the attachments), which providers delete with everything in it.
            val uri = target(r, create = false, folders = true)
            uri != null && DocumentsContract.deleteDocument(resolver, uri)
        }
        else -> throw IllegalArgumentException("unknown call")
    }

    /**
     * The document a call is about: the picked file itself when `name` is null, otherwise a child
     * of the folder at `path` — created empty when asked to and missing. Only files, unless
     * [folders] says a folder will do.
     */
    private fun target(r: JSONObject, create: Boolean, folders: Boolean = false): Uri? {
        val ref = Uri.parse(r.getString("ref"))
        if (r.isNull("name")) return ref
        val parent = walk(ref, path(r)) ?: return null
        val name = safeName(r.getString("name"))
        children(ref, parent).firstOrNull { it.name == name && (folders || !it.isDir) }?.let {
            return DocumentsContract.buildDocumentUriUsingTree(ref, it.id)
        }
        if (!create) return null
        return DocumentsContract.createDocument(
            resolver,
            DocumentsContract.buildDocumentUriUsingTree(ref, parent),
            MIME,
            name,
        )
    }

    /** The document id of the folder at `path` under the picked tree, or null when it is not there. */
    private fun walk(tree: Uri, path: List<String>): String? {
        var id = DocumentsContract.getTreeDocumentId(tree)
        for (segment in path) {
            id = children(tree, id).firstOrNull { it.name == segment && it.isDir }?.id ?: return null
        }
        return id
    }

    private fun children(tree: Uri, parent: String): List<Child> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent)
        val columns = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE)
        val out = mutableListOf<Child>()
        resolver.query(uri, columns, null, null, null)?.use {
            while (it.moveToNext()) {
                out += Child(it.getString(0), it.getString(1) ?: "", it.getString(2) == Document.MIME_TYPE_DIR)
            }
        }
        return out
    }

    private fun treeRoot(tree: Uri) =
        DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))

    private fun path(r: JSONObject): List<String> {
        val a = r.optJSONArray("path") ?: return emptyList()
        return (0 until a.length()).map { safeName(a.getString(it)) }
    }

    private fun handle() = nextHandle.incrementAndGet().toString()

    private class Pending(val id: Long, val reply: JavaScriptReplyProxy)

    private class Child(val id: String, val name: String, val isDir: Boolean)

    companion object {
        /** The object name the page sees: `window.HearthFiles`. */
        const val CHANNEL = "HearthFiles"

        /** Kept in step with `CHUNK_BYTES` in native.ts. */
        const val CHUNK_BYTES = 1 shl 20

        private const val MIME = "application/octet-stream"
        private const val READ_WRITE =
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

        fun success(id: Long, value: Any): String =
            JSONObject().put("id", id).put("ok", true).put("value", value).toString()

        fun failure(id: Long, error: String): String =
            JSONObject().put("id", id).put("ok", false).put("error", error).toString()

        /**
         * A name inside the picked folder. SAF names are display names, not paths, so this is not
         * what keeps the page inside the folder — the tree grant is — but a separator or a dot
         * segment is never something the web app meant to send.
         */
        fun safeName(name: String): String {
            require(name.isNotEmpty() && name != "." && name != ".." && '/' !in name && '\u0000' !in name) {
                "not a file name"
            }
            return name
        }

        /** Up to [max] bytes, or fewer only at the end of the stream; empty means the end. */
        fun readChunk(stream: InputStream, max: Int): ByteArray {
            val buffer = ByteArray(max)
            var filled = 0
            while (filled < max) {
                val n = stream.read(buffer, filled, max - filled)
                if (n < 0) break
                filled += n
            }
            return if (filled == max) buffer else buffer.copyOf(filled)
        }
    }
}
