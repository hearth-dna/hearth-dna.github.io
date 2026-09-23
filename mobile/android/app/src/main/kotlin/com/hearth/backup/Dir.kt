package com.hearth.backup

import com.hearth.data.Repo
import com.hearth.genome.sha256Hex
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Where backups go, behind one small interface (backup/folder.ts `Dir`): a folder the system picker
 * granted, a single picked file, or a cloud drive. Past here the kind of place is invisible.
 * Every call does I/O: run it off the main thread.
 */
interface Dir {
    val name: String
    /** A single file, not a folder: it holds the snapshot and nothing beside it. */
    val single: Boolean
    /** The provider keeps earlier versions itself (Drive, Dropbox): no `.1`/`.2` copies. */
    val versioned: Boolean
    fun names(): List<String>
    fun read(name: String): ByteArray?
    /** The first [bytes] of a file (or all of a shorter one); null when it is not there. */
    fun readHead(name: String, bytes: Int): ByteArray?
    fun write(name: String, bytes: ByteArray)
    /** Removes a file or a whole folder. */
    fun remove(name: String)
    /** A subfolder, or null when it is not there and [create] is false. */
    fun subdir(name: String, create: Boolean = false): Dir?
}

// ---- naming (backup/naming.ts) ---------------------------------------------------------------

const val ROTATIONS = 3
const val PROFILE = "default"
const val SNAPSHOT = "hearth-backup.hearth"
const val ATTACHMENTS_DIR = "attachments"
const val GENOMES_DIR = "genomes"

fun rotatedName(base: String, n: Int) = "$base.$n"

/** Copies to make, oldest first, so that [base] can then be overwritten with the newest snapshot. */
fun rotationPlan(existing: List<String>, base: String, keep: Int = ROTATIONS): List<Pair<String, String>> {
    val have = existing.toSet()
    val plan = mutableListOf<Pair<String, String>>()
    for (n in keep - 1 downTo 1) if (rotatedName(base, n) in have) plan.add(rotatedName(base, n) to rotatedName(base, n + 1))
    if (base in have) plan.add(base to rotatedName(base, 1))
    return plan
}

/** The header of the snapshot this phone last wrote to or loaded from the place. */
data class Seen(val device: String, val generation: Long)

/** The place holds a snapshot newer than what this phone has loaded from it. */
fun hasNewer(current: JSONObject?, ourDevice: String, lastSeen: Seen?): Boolean {
    if (current == null || current.optString("device") == ourDevice) return false
    return lastSeen == null || lastSeen.device != current.optString("device") || current.optLong("generation") > lastSeen.generation
}

fun readme(url: String) = listOf(
    "This folder is written by Hearth, a local-first family genome browser.",
    "",
    "hearth-backup*.hearth files are snapshots of everything in the app (people, genome files, health",
    "log, notes). The newest is hearth-backup.hearth; .1, .2, ... are older copies. A file starting",
    "with \"HRTH2\" is encrypted with the passphrase set in Hearth; a file starting with \"PK\" is a",
    "plain zip and readable by anyone who has it.",
    "",
    "The attachments folder holds one file per image or PDF attached to a health log entry, named",
    "after the content of the file. Files starting with \"HRTH1\" are encrypted with the same",
    "passphrase. They are written once and kept even after an entry is deleted, because the older",
    "snapshots above may still refer to them; removing one only loses that document.",
    "",
    "To restore: open $url, go to Settings, choose this folder, and press \"Load from folder\".",
    "",
).joinToString("\n")

// ---- the snapshot in a place (backup/folder.ts) ---------------------------------------------

/** Enough for any header Hearth writes; the rest of the snapshot stays where it is. */
private const val HEAD_BYTES = 64 * 1024

private fun u16(b: ByteArray, at: Int) = (b[at].toInt() and 0xff) or ((b[at + 1].toInt() and 0xff) shl 8)
private fun u32(b: ByteArray, at: Int) = u16(b, at).toLong() or (u16(b, at + 2).toLong() shl 16)

/**
 * The header from a file's first bytes alone (container.ts `readHeaderPrefix`): plaintext ahead of
 * an envelope, or the first, stored zip entry. Null when these bytes do not settle it.
 */
fun readHeaderPrefix(b: ByteArray): JSONObject? {
    val magic = "HRTH2".toByteArray()
    if (b.size > 7 && magic.indices.all { b[it] == magic[it] }) {
        val len = ((b[5].toInt() and 0xff) shl 8) or (b[6].toInt() and 0xff)
        return if (b.size < 7 + len) null else JSONObject(String(b, 7, len))
    }
    if (b.size < 30 || u32(b, 0) != 0x04034b50L || u16(b, 8) != 0) return null
    val size = u32(b, 18).toInt()
    val nameLength = u16(b, 26)
    val start = 30 + nameLength + u16(b, 28)
    if (b.size < start + size || String(b, 30, nameLength) != "header.json") return null
    return JSONObject(String(b, start, size))
}

/** Header of the snapshot in the place; null when there is none or it cannot be read. */
fun currentHeader(dir: Dir, base: String = SNAPSHOT): JSONObject? {
    val head = dir.readHead(base, HEAD_BYTES) ?: return null
    return runCatching {
        readHeaderPrefix(head) ?: (if (head.size < HEAD_BYTES) head else dir.read(base))?.let { openContainerHeader(it) }
    }.getOrNull()
}

/** The header of a whole v2 file, plain or sealed, without opening the sealed part. */
private fun openContainerHeader(bytes: ByteArray): JSONObject? = readHeaderPrefix(bytes) ?: runCatching { openContainer(bytes).header }.getOrNull()

/**
 * Rotates the previous snapshots by copying, then writes the new one over [base] (folder.ts
 * `writeSnapshot`); a crash mid-write leaves `base.1` intact. A single file has nowhere to rotate
 * to, and a versioned drive keeps its own history.
 */
fun writeSnapshot(dir: Dir, bytes: ByteArray, appUrl: String, base: String = SNAPSHOT) {
    if (dir.single) return dir.write(base, bytes)
    val have = dir.names()
    if (!dir.versioned) for ((from, to) in rotationPlan(have, base)) dir.read(from)?.let { dir.write(to, it) }
    dir.write(base, bytes)
    if ("README.txt" !in have) dir.write("README.txt", readme(appUrl).toByteArray())
}

/** Best effort: every snapshot of this profile, conflict copies from older versions included. */
fun deleteSnapshots(dir: Dir, base: String = SNAPSHOT): Int {
    var n = 0
    for (name in dir.names()) {
        if (name == base || name.startsWith("$base.") || name.startsWith(base.removeSuffix(".hearth") + ".conflict-")) {
            runCatching { dir.remove(name) }
            n++
        }
    }
    return n
}

fun removeDir(dir: Dir, name: String): Int {
    val sub = dir.subdir(name) ?: return 0
    val n = sub.names().size
    runCatching { dir.remove(name) }
    return n
}

// ---- sidecars: attached documents and genomes beside the snapshot ----------------------------

private val SIDE_MAGIC = "HRTH1".toByteArray()

fun isSealedSidecar(b: ByteArray) = b.size > 33 && SIDE_MAGIC.indices.all { b[it] == SIDE_MAGIC[it] }

/**
 * Sidecar encryption (attachments/crypto.ts): the dump v1 envelope, `HRTH1 | salt | nonce | GCM`.
 * One key per run: the files share a salt and each gets its own nonce.
 */
class Sealer(passphrase: String) {
    private val random = SecureRandom()
    private val salt = ByteArray(16).also(random::nextBytes)
    private val key = SecretKeySpec(pbkdf2Sha256(passphrase, salt, 600_000), "AES")

    fun seal(plain: ByteArray): ByteArray {
        val nonce = ByteArray(12).also(random::nextBytes)
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce)) }
        return SIDE_MAGIC + salt + nonce + c.doFinal(plain)
    }
}

/** Opens sidecars, deriving a key once per salt seen. */
class Opener(private val passphrase: String) {
    private var cached: Pair<String, SecretKeySpec>? = null

    fun open(b: ByteArray): ByteArray {
        require(isSealedSidecar(b)) { "not an encrypted file" }
        val salt = b.copyOfRange(5, 21)
        val id = salt.joinToString("") { "%02x".format(it) }
        val key = cached?.takeIf { it.first == id }?.second
            ?: SecretKeySpec(pbkdf2Sha256(passphrase, salt, 600_000), "AES").also { cached = id to it }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, b.copyOfRange(21, 33))) }
        return c.doFinal(b, 33, b.size - 33)
    }
}

fun sidecarName(sha: String) = "$sha.att"
private val SIDECAR = Regex("^[0-9a-f]{64}\\.att$")

/** Kept small so one automatic backup never sits on the place for minutes (mirror.ts). */
private const val MAX_FILES_PER_RUN = 25
private const val MAX_BYTES_PER_RUN = 100L * 1024 * 1024

/** Copies the attached documents the place does not have yet; returns how many files it holds after. */
fun mirrorAttachments(dir: Dir, repo: Repo, passphrase: String?): Int {
    val wanted = repo.sql.query("SELECT DISTINCT sha256 FROM attachment ORDER BY sha256").map { it["sha256"] as String }
    if (wanted.isEmpty()) return 0
    val sub = dir.subdir(ATTACHMENTS_DIR, create = true) ?: error("cannot open the attachments folder")
    val present = sub.names()
    val have = present.filter { SIDECAR.matches(it) }.map { it.take(64) }.toSet()
    val seal = passphrase?.let { Sealer(it) }
    var written = 0
    var bytes = 0L
    for (sha in wanted.filter { it !in have }) {
        if (written >= MAX_FILES_PER_RUN || bytes >= MAX_BYTES_PER_RUN) break
        // Metadata restored on a phone that never had the document: another device will copy it.
        val plain = repo.blobs.get(Repo.attachmentBlobName(sha)) ?: continue
        sub.write(sidecarName(sha), seal?.seal(plain) ?: plain)
        written++
        bytes += plain.size
    }
    return present.count { SIDECAR.matches(it) } + written
}

/**
 * Fetches documents this phone has rows for but not bytes (mirror.ts `pullAttachments`). Each file
 * is hashed again: the name is a claim about the content, and a folder is something other programs
 * can write to. Returns (pulled, missing).
 */
fun pullAttachments(dir: Dir, repo: Repo, passphrase: String?): Pair<Int, Int> {
    val shas = repo.sql.query("SELECT DISTINCT sha256 FROM attachment").map { it["sha256"] as String }
    val have = repo.blobs.list().toSet()
    val todo = shas.filter { Repo.attachmentBlobName(it) !in have }
    if (todo.isEmpty()) return 0 to 0
    val sub = dir.subdir(ATTACHMENTS_DIR) ?: return 0 to todo.size
    val open = passphrase?.let { Opener(it) }
    var pulled = 0
    for (sha in todo) {
        val raw = sub.read(sidecarName(sha)) ?: continue
        val plain = runCatching { if (isSealedSidecar(raw)) open?.open(raw) else raw }.getOrNull() ?: continue
        if (sha256Hex(plain) != sha) continue
        repo.blobs.put(Repo.attachmentBlobName(sha), plain)
        pulled++
    }
    return pulled to todo.size - pulled
}

/** Writes the genome files the place does not have yet, before the snapshot that names them (genomes.ts). */
fun mirrorGenomes(dir: Dir, repo: Repo, files: List<GenomeFile>, passphrase: String?) {
    if (files.isEmpty()) return
    val sub = dir.subdir(GENOMES_DIR, create = true) ?: error("cannot open the genomes folder")
    val have = sub.names().toSet()
    val todo = files.filter { it.path.substringAfterLast('/') !in have }
    if (todo.isEmpty()) return
    val seal = passphrase?.let { Sealer(it) }
    for (f in todo) {
        val bytes = repo.blobs.get(f.blob) ?: error("genome file ${f.blob} is missing from this device")
        sub.write(f.path.substringAfterLast('/'), seal?.seal(bytes) ?: bytes)
    }
}

/** Reads genome files back for a restore; the restore checks each against the manifest. */
fun genomeLoader(dir: Dir, passphrase: String?): (GenomeEntry) -> ByteArray? {
    val sub = dir.subdir(GENOMES_DIR) ?: return { null }
    val open = passphrase?.let { Opener(it) }
    return { entry ->
        sub.read(entry.path.substringAfterLast('/'))?.let { raw ->
            if (!isSealedSidecar(raw)) raw else open?.open(raw) ?: throw BackupException("native.encryptedTitle")
        }
    }
}
