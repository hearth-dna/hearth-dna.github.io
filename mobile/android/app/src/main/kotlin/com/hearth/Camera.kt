package com.hearth

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File

/**
 * The "take a photo" option next to the file picker, for photographing a medical document on the
 * Import page. The system camera app does the capture, so the shell needs no CAMERA permission:
 * an app that does not declare it may still start the camera app, and it writes the picture to a
 * file this app offers through its [FileProvider]. That file is the only copy the shell makes,
 * it is handed straight to the WebView, and the directory is emptied before every capture and
 * when the app starts and stops.
 */
object Camera {
    private const val DIR = "camera"

    /** Whether an `<input accept="…">` takes pictures at all. Empty means "anything". */
    fun wantsImages(acceptTypes: Array<String>): Boolean {
        val types = acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        return types.isEmpty() ||
            types.any { it.startsWith("image/") || it in IMAGE_EXTENSIONS }
    }

    private val IMAGE_EXTENSIONS = setOf(".jpg", ".jpeg", ".png", ".webp", ".heic")

    /** A capture in progress: the intent to start, the file it writes and the URI the page gets. */
    class Capture(val intent: Intent, val file: File, val uri: Uri) {
        /** What the page receives once the camera app returns: the photo, if one was taken. */
        fun result(): Array<Uri>? = if (file.length() > 0) arrayOf(uri) else null
    }

    /** A capture writing into a fresh file under the cache directory. */
    fun capture(context: Context): Capture? {
        val dir = File(context.cacheDir, DIR)
        clear(context)
        if (!dir.mkdirs() && !dir.isDirectory) return null
        val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.camera", file)
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return Capture(intent, file, uri)
    }

    /** Deletes every photo the shell ever captured. */
    fun clear(context: Context) {
        File(context.cacheDir, DIR).listFiles()?.forEach { it.delete() }
    }
}
