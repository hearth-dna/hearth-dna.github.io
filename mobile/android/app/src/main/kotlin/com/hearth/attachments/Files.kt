package com.hearth.attachments

/**
 * What may be attached to a health log entry (frontend/src/attachments/file.ts): the types, the
 * limits, how the type is told from the bytes, and how a name is made safe to show.
 */
const val MAX_FILE_BYTES = 25L * 1024 * 1024
const val MAX_PER_ENTRY = 12

/** The app's own ceiling for all attachments together (quota.ts `MAX_TOTAL_BYTES`). */
const val MAX_TOTAL_BYTES = 2L * 1024 * 1024 * 1024

/** Offered in the file picker; the same set the document reader accepts. */
val ACCEPT = arrayOf("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf")

private fun ByteArray.starts(at: Int, vararg bytes: Int) = bytes.indices.all { at + it < size && this[at + it] == bytes[it].toByte() }
private fun ByteArray.ascii(at: Int, s: String) = starts(at, *s.map { it.code }.toIntArray())

/**
 * The type the bytes actually are, or null. The picker's type is the provider's guess from the
 * extension, a hint and never a decision: a renamed executable must not become an "image/png".
 */
fun sniffMime(b: ByteArray): String? {
    if (b.size < 12) return null
    if (b.starts(0, 0xff, 0xd8, 0xff)) return "image/jpeg"
    if (b.starts(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png"
    if (b.ascii(0, "RIFF") && b.ascii(8, "WEBP")) return "image/webp"
    if (b.ascii(0, "%PDF-")) return "application/pdf"
    if (b.ascii(4, "ftyp")) {
        // The brand sits at offset 8 of the ISO-BMFF box; HEIF images share the container with video.
        val brand = String(b, 8, 4, Charsets.ISO_8859_1)
        if (brand == "heic" || brand == "heix" || brand == "hevc") return "image/heic"
        if (brand == "mif1" || brand == "msf1" || brand == "heim") return "image/heif"
    }
    return null
}

private val CONTROL = Regex("[\\u0000-\\u001f\\u007f]")
private val SEPARATORS = Regex("[\\\\/]")
private val SPACES = Regex("\\s+")

/** A file name fit to show. Stored and displayed, never used to build a path. */
fun safeDisplayName(raw: String): String =
    raw.replace(CONTROL, " ").replace(SEPARATORS, " ").replace(SPACES, " ").trim().take(120).ifEmpty { "document" }

enum class Rejection { TYPE, SIZE, COUNT, SPACE }

/** Why this file cannot be attached, or null when it can. */
fun checkFile(size: Long, sniffed: String?, already: Int): Rejection? = when {
    sniffed == null -> Rejection.TYPE
    size > MAX_FILE_BYTES || size == 0L -> Rejection.SIZE
    already >= MAX_PER_ENTRY -> Rejection.COUNT
    else -> null
}
