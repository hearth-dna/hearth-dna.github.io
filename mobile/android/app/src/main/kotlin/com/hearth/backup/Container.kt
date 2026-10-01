package com.hearth.backup

import com.hearth.genome.sha256Hex
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Reads a dump v2 backup (docs/architecture/storage/dump-v2.md, frontend/src/export/container.ts):
 * a zip of header.json, manifest.json and journal.json plus the gzipped genomes the manifest
 * lists, optionally inside the `HRTH2` envelope, which is the magic, a 2-byte big-endian header
 * length, the plaintext header, a 16-byte salt, a 12-byte nonce and the AES-256-GCM ciphertext of
 * the zip. [genomes] maps a manifest path to its bytes, each checked against the manifest's sha256.
 */
class Container(
    val header: JSONObject,
    val manifest: JSONObject,
    val journal: JSONObject,
    val genomes: Map<String, ByteArray> = emptyMap(),
) {
    /** The manifest's genome entries (`GenomeEntry` in container.ts). */
    val genomeEntries: List<GenomeEntry>
        get() {
            val a = manifest.optJSONArray("genomes") ?: return emptyList()
            return (0 until a.length()).map { i ->
                val g = a.getJSONObject(i)
                GenomeEntry(
                    path = g.getString("path"),
                    sha256 = g.getString("sha256"),
                    personId = g.getString("person_id"),
                    provider = g.optString("provider", "generic"),
                    original = g.optString("kind") == "original",
                )
            }
        }
}

data class GenomeEntry(val path: String, val sha256: String, val personId: String, val provider: String, val original: Boolean)

/** Why a file would not open, as the i18n key of the message to show. */
class BackupException(val key: String) : Exception(key)

private val MAGIC = "HRTH2".toByteArray()
private const val PBKDF2_ITERATIONS = 600_000

fun isEncrypted(bytes: ByteArray): Boolean =
    bytes.size > MAGIC.size && MAGIC.indices.all { bytes[it] == MAGIC[it] }

/** Bytes → container. Throws [BackupException] naming the message to show. */
fun openContainer(bytes: ByteArray, passphrase: String? = null): Container {
    val zip = if (isEncrypted(bytes)) decrypt(bytes, passphrase) else bytes
    if (zip.size < 2 || zip[0] != 'P'.code.toByte() || zip[1] != 'K'.code.toByte())
        throw BackupException("native.notBackup")
    val entries = unzip(zip)
    fun json(name: String) = JSONObject(entries[name]?.toString(Charsets.UTF_8) ?: throw BackupException("native.damaged"))
    val header = json("header.json")
    if (header.optString("format") != "hearth-dump" || header.optInt("version") != 2)
        throw BackupException("native.notBackup")
    val c = Container(header, json("manifest.json"), json("journal.json"))
    val external = c.manifest.optBoolean("external_genomes")
    val genomes = mutableMapOf<String, ByteArray>()
    for (g in c.genomeEntries) {
        val data = entries[g.path]
        if (data == null && external) continue
        // A missing or altered genome refuses the whole file, as on the web: half a family is worse
        // than an error the user can act on.
        if (data == null || sha256Hex(data) != g.sha256) throw BackupException("native.damaged")
        genomes[g.path] = data
    }
    return Container(c.header, c.manifest, c.journal, genomes)
}

private fun decrypt(bytes: ByteArray, passphrase: String?): ByteArray {
    if (passphrase.isNullOrEmpty()) throw BackupException("native.encryptedTitle")
    var o = MAGIC.size
    val len = ((bytes[o].toInt() and 0xff) shl 8) or (bytes[o + 1].toInt() and 0xff)
    o += 2 + len
    if (bytes.size < o + 16 + 12 + 16) throw BackupException("native.damaged")
    val salt = bytes.copyOfRange(o, o + 16)
    val nonce = bytes.copyOfRange(o + 16, o + 28)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(pbkdf2Sha256(passphrase, salt, PBKDF2_ITERATIONS), "AES"), GCMParameterSpec(128, nonce))
    return try {
        cipher.doFinal(bytes, o + 28, bytes.size - o - 28)
    } catch (_: AEADBadTagException) {
        throw BackupException("app.wrongPassphrase")
    }
}

/**
 * PBKDF2-HMAC-SHA256 over the passphrase's UTF-8 bytes, as WebCrypto derives it. Written out
 * rather than taken from SecretKeyFactory, whose handling of non-ASCII passphrases differs
 * between providers; a passphrase with an accent must open the same file everywhere.
 */
fun pbkdf2Sha256(passphrase: String, salt: ByteArray, iterations: Int, bytes: Int = 32): ByteArray {
    val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(passphrase.toByteArray(Charsets.UTF_8), "HmacSHA256")) }
    val out = ByteArray(bytes)
    var block = 1
    var filled = 0
    while (filled < bytes) {
        mac.update(salt)
        var u = mac.doFinal(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
        val t = u.copyOf()
        repeat(iterations - 1) {
            u = mac.doFinal(u)
            for (i in t.indices) t[i] = (t[i].toInt() xor u[i].toInt()).toByte()
        }
        val n = minOf(t.size, bytes - filled)
        t.copyInto(out, filled, 0, n)
        filled += n
        block++
    }
    return out
}

private fun unzip(zip: ByteArray): Map<String, ByteArray> {
    val out = mutableMapOf<String, ByteArray>()
    try {
        ZipInputStream(ByteArrayInputStream(zip)).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (!e.isDirectory) out[e.name] = z.readBytes()
            }
        }
    } catch (_: java.util.zip.ZipException) {
        throw BackupException("native.damaged")
    }
    return out
}
