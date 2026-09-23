package com.hearth.genome

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import java.util.zip.ZipInputStream

/**
 * A picked file as text (unpack.ts `fileToText`): a .zip gives its largest entry, a .gz its
 * contents, anything else is read as UTF-8. All on the phone; nothing is uploaded.
 */
data class Unpacked(val text: String, val innerName: String)

fun fileToText(bytes: ByteArray, fileName: String): Unpacked {
    val name = fileName.lowercase()
    val isZip = name.endsWith(".zip") || (bytes.size > 1 && bytes[0] == 0x50.toByte() && bytes[1] == 0x4b.toByte())
    val isGz = name.endsWith(".gz") || (bytes.size > 1 && bytes[0] == 0x1f.toByte() && bytes[1] == 0x8b.toByte())
    if (isZip) {
        var best: Pair<String, ByteArray>? = null
        ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (e.isDirectory || e.name.startsWith("__MACOSX")) continue
                val data = z.readBytes()
                if (best == null || data.size > best!!.second.size) best = e.name to data
            }
        }
        val (inner, data) = best ?: error("zip archive contains no files")
        return Unpacked(decode(data), inner)
    }
    if (isGz) return Unpacked(decode(gunzip(bytes)), fileName.replace(Regex("\\.gz$", RegexOption.IGNORE_CASE), ""))
    return Unpacked(decode(bytes), fileName)
}

/** TextDecoder's defaults: UTF-8, malformed bytes replaced, a leading byte-order mark dropped. */
fun decode(bytes: ByteArray): String = String(bytes, Charsets.UTF_8).removePrefix("﻿")

fun gunzip(bytes: ByteArray): ByteArray = GZIPInputStream(ByteArrayInputStream(bytes)).use { it.readBytes() }

fun gzip(bytes: ByteArray): ByteArray = ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(bytes) } }.toByteArray()

fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

fun sha256Hex(text: String): String = sha256Hex(text.toByteArray(Charsets.UTF_8))
