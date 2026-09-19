package com.hearth

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

/**
 * Saving a file out of the web app — the dump, the CSV/JSON Lines exports, the portable archive.
 *
 * The web app hands every file to the browser the same way: it wraps the bytes in a `Blob`, points
 * an `<a download>` at the object URL and clicks it (`frontend/src/export/exportDump.ts`). A
 * WebView reports that click to its download listener as a `blob:` URL it cannot fetch, and the web
 * app revokes the URL immediately after the click, so by the time anything native runs there is
 * nothing left to read.
 *
 * So the shell keeps the `Blob` itself. [INSTALL_JS] wraps `URL.createObjectURL` to hold a
 * reference to the last few blobs, and [start] asks the page to stream the one that was clicked
 * back in chunks. Chunks, not one string: a family dump is tens of megabytes, and a base64 copy of
 * the whole thing crossing the bridge at once is an OutOfMemoryError on a mid-range phone.
 *
 * The file lands in the public Downloads folder through MediaStore, which needs no permission and
 * gives the user a file they can hand to any other app — the same contract the browser download
 * has on desktop.
 */
object Downloads {
    const val BRIDGE_NAME = "HearthShell"

    /** Chunk size on the JS side; kept in sync with [INSTALL_JS]. */
    private const val CHUNK_BYTES = 1 shl 20

    fun install(view: WebView) = view.evaluateJavascript(INSTALL_JS, null)

    /** Called from the WebView's download listener, on the UI thread. */
    fun start(view: WebView, url: String, contentDisposition: String?, mimeType: String?) {
        if (!url.startsWith("blob:")) return
        val name = fileName(contentDisposition, mimeType)
        val mime = mimeType?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
        view.evaluateJavascript(
            "window.__hearthSave(${quote(url)},${quote(name)},${quote(mime)})",
            null,
        )
    }

    private fun quote(value: String) = JSONObject.quote(value)

    /**
     * The name to save under. `Content-Disposition` is what the `download` attribute becomes by the
     * time it reaches the listener; when it is missing or unusable, the extension comes from the
     * MIME type and the stem from the app's own naming.
     */
    fun fileName(contentDisposition: String?, mimeType: String?): String {
        val fromHeader = contentDisposition
            ?.let { DISPOSITION_FILENAME.find(it)?.groupValues?.get(1) }
            ?.trim('"', ' ')
            ?.let(::sanitise)
        if (!fromHeader.isNullOrBlank()) return fromHeader
        val extension = when (mimeType) {
            "application/json" -> ".json"
            "text/csv" -> ".csv"
            "text/html" -> ".html"
            else -> ".bin"
        }
        return "hearth-export$extension"
    }

    /**
     * Strips everything a file name must not carry: path separators (a name is not a location),
     * and the NUL and control bytes that a display name can smuggle past a check. Not a security
     * boundary on its own — MediaStore takes a display name, not a path — but the cheap half of one.
     */
    fun sanitise(name: String): String =
        name.substringAfterLast('/')
            .substringAfterLast('\\')
            .filter { it.code >= 0x20 }
            .trim()
            .take(120)
            .ifBlank { "hearth-export.bin" }

    /**
     * The three calls the page makes. Every one of them runs on the WebView's JavaScript thread,
     * never the UI thread, so the stream work happens where it already is.
     */
    class Bridge(private val context: Context) {
        private val open = ConcurrentHashMap<String, Sink>()
        private val main = Handler(Looper.getMainLooper())

        @JavascriptInterface
        fun beginSave(name: String, mime: String): String {
            val display = sanitise(name)
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, display)
                put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                // Hidden from other apps until the last chunk lands, so nothing can pick up a
                // half-written dump and call it a backup.
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: return ""
            val stream = resolver.openOutputStream(uri) ?: run {
                resolver.delete(uri, null, null)
                return ""
            }
            val id = uri.toString()
            open[id] = Sink(uri.toString(), stream, display)
            return id
        }

        @JavascriptInterface
        fun writeChunk(id: String, base64: String): Boolean {
            val sink = open[id] ?: return false
            return try {
                sink.stream.write(Base64.decode(base64, Base64.DEFAULT))
                true
            } catch (_: Exception) {
                abort(id)
                false
            }
        }

        @JavascriptInterface
        fun endSave(id: String, complete: Boolean) {
            val sink = open.remove(id) ?: return
            val uri = android.net.Uri.parse(sink.uri)
            try {
                sink.stream.close()
            } catch (_: Exception) {
                // Nothing left to do about it; the pending-file cleanup below is the real handling.
            }
            if (!complete) {
                context.contentResolver.delete(uri, null, null)
                toast(context.getString(R.string.save_failed))
                return
            }
            context.contentResolver.update(
                uri,
                ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) },
                null,
                null,
            )
            toast(context.getString(R.string.saved_to_downloads, sink.displayName))
        }

        private fun abort(id: String) {
            val sink = open.remove(id) ?: return
            runCatching { sink.stream.close() }
            context.contentResolver.delete(android.net.Uri.parse(sink.uri), null, null)
        }

        private fun toast(message: String) =
            main.post { Toast.makeText(context, message, Toast.LENGTH_LONG).show() }

        private class Sink(val uri: String, val stream: OutputStream, val displayName: String)
    }

    private val DISPOSITION_FILENAME =
        Regex("""filename\*?=(?:UTF-8'')?["']?([^"';]+)""", RegexOption.IGNORE_CASE)

    /**
     * Injected after every page load (from `evaluateJavascript`, so the page's own
     * `script-src 'self'` has no say in it — it is not a script the document loaded).
     *
     * It holds the last few blobs the page created. `URL.revokeObjectURL` still runs exactly as the
     * page wrote it; what survives the revoke is the `Blob` object, which is all the reader needs.
     */
    private val INSTALL_JS = """
        (() => {
          if (window.__hearthSave) return
          const kept = new Map()
          const create = URL.createObjectURL.bind(URL)
          URL.createObjectURL = (object) => {
            const url = create(object)
            if (object instanceof Blob) {
              kept.set(url, object)
              // Two is enough for "the file that was just clicked" and costs no copy: these are
              // references to blobs the page is holding anyway.
              while (kept.size > 2) kept.delete(kept.keys().next().value)
            }
            return url
          }
          const base64 = (bytes) => {
            let binary = ''
            for (let i = 0; i < bytes.length; i += 0x8000) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
            }
            return btoa(binary)
          }
          // The click, not the download listener, is where the name is. `downloadBytes` builds a
          // detached <a download="hearth-dump-2026-09-19.hearth"> and clicks it, and a detached
          // element's click never reaches a document listener — so the patch goes on the prototype.
          // What the WebView reports to its download listener has lost the attribute by then, and
          // the file would be saved as the generic fallback name.
          const click = HTMLAnchorElement.prototype.click
          HTMLAnchorElement.prototype.click = function () {
            const href = this.getAttribute('href') || ''
            if (this.hasAttribute('download') && kept.has(href)) {
              window.__hearthSave(href, this.getAttribute('download') || '', kept.get(href).type || '')
              return
            }
            return click.apply(this, arguments)
          }
          window.__hearthSave = async (url, name, mime) => {
            const blob = kept.get(url)
            if (!blob) return
            const id = $BRIDGE_NAME.beginSave(name, mime)
            if (!id) return
            try {
              for (let offset = 0; offset < blob.size; offset += $CHUNK_BYTES) {
                const slice = await blob.slice(offset, offset + $CHUNK_BYTES).arrayBuffer()
                if (!$BRIDGE_NAME.writeChunk(id, base64(new Uint8Array(slice)))) return
              }
              $BRIDGE_NAME.endSave(id, true)
            } catch (error) {
              $BRIDGE_NAME.endSave(id, false)
            } finally {
              kept.delete(url)
            }
          }
        })()
    """.trimIndent()
}
