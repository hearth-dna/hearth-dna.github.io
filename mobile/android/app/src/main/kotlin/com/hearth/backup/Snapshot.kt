package com.hearth.backup

import com.hearth.data.Repo
import com.hearth.data.Sql
import com.hearth.genome.gzip
import com.hearth.genome.sha256Hex
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.util.zip.CRC32
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** A genome a folder snapshot names but keeps beside itself: its path in the manifest, and the blob with its bytes. */
data class GenomeFile(val path: String, val blob: String)

/** A snapshot ready to write: the container, and for a folder backup the genome files that go beside it. */
class Snapshot(val container: Container, val files: List<GenomeFile>)

fun genomePath(sha256OfBytes: String) = "genomes/$sha256OfBytes.txt.gz"

/** A query's rows as JSON objects, SQL types kept (a JSON number for INTEGER and REAL). */
private fun rows(sql: Sql, query: String): JSONArray = JSONArray().apply {
    for (r in sql.query(query)) put(JSONObject().apply { for ((k, v) in r) put(k, v ?: JSONObject.NULL) })
}

/**
 * The sha256 of a cached genome blob, computed once and remembered in meta (bookkeeping, no
 * generation bump), so a folder snapshot never reads genome bytes again (snapshot.ts `blobSha`).
 */
private fun blobSha(repo: Repo, blob: String, bytes: ByteArray?): String {
    val key = "genome-sha:$blob"
    repo.getMeta(key)?.let { return it }
    val data = bytes ?: repo.blobs.get(blob) ?: error("genome file $blob is missing from this device")
    return sha256Hex(data).also { repo.setMeta(key, it) }
}

/**
 * A person's genotypes as the generic provider text (db.worker.ts `genomeText`), for someone whose
 * original file was not kept. Tab-separated; the header is a comment every parser skips.
 */
private fun genomeText(sql: Sql, personId: String): String = buildString {
    append("# Hearth export: rsid chromosome position genotype (forward strand)")
    for (r in sql.query("SELECT rsid, chromosome, position, a1 || a2 AS g FROM genotype WHERE person_id = ? ORDER BY chromosome, position", listOf(personId))) {
        append('\n').append(r["rsid"]).append('\t').append(r["chromosome"]).append('\t').append(r["position"]).append('\t').append(r["g"])
    }
}

/**
 * The dump v2 container from the live database (snapshot.ts `buildSnapshot`). Genomes come from the
 * originals kept at import; a person without one gets a rebuilt generic file, cached under a name
 * that carries the row count. With [embed] false (the backup folder's form) the manifest lists the
 * genomes but their bytes travel beside the snapshot as write-once files.
 */
fun buildSnapshot(repo: Repo, appVersion: String, embed: Boolean = true): Snapshot {
    val sql = repo.sql
    val sourceFiles = repo.listSourceFiles()
    val counts = repo.genotypeCounts()
    val cached = repo.blobs.list().toSet()
    val genomes = LinkedHashMap<String, ByteArray>()
    val entries = JSONArray()
    val files = mutableListOf<GenomeFile>()
    fun add(blob: String, entry: JSONObject) {
        val bytes = if (embed) repo.blobs.get(blob) ?: error("genome file $blob is missing from this device") else null
        val hash = blobSha(repo, blob, bytes)
        val path = genomePath(hash)
        if (bytes != null) genomes[path] = bytes else files.add(GenomeFile(path, blob))
        entries.put(JSONObject().put("path", path).put("sha256", hash).apply { for (k in entry.keys()) put(k, entry.get(k)) })
    }
    for (p in repo.listPersons()) {
        val n = counts[p.id] ?: 0
        if (n == 0) continue
        val sfs = sourceFiles.filter { it.personId == p.id }
        if (sfs.isNotEmpty() && sfs.all { Repo.genomeBlobName(it.sha256) in cached }) {
            for (sf in sfs) {
                add(
                    Repo.genomeBlobName(sf.sha256),
                    JSONObject().put("person_id", p.id).put("source_file_id", sf.id).put("provider", sf.provider.id).put("build", sf.build).put("kind", "original"),
                )
            }
        } else {
            val name = Repo.rebuiltBlobName(p.id, n)
            if (name !in cached) repo.blobs.put(name, gzip(genomeText(sql, p.id).toByteArray()))
            add(
                name,
                JSONObject().put("person_id", p.id).put("source_file_id", JSONObject.NULL).put("provider", "generic")
                    .put("build", sfs.firstOrNull()?.build ?: "37").put("kind", "reconstructed"),
            )
        }
    }
    val header = JSONObject()
        .put("format", "hearth-dump")
        .put("version", 2)
        .put("generation", repo.getMeta("generation")?.toLongOrNull() ?: 0)
        .put("device", repo.getMeta("device") ?: "")
        .put("exported_at", Repo.now())
        .put("encrypted", false)
    val manifest = JSONObject().put("app_version", appVersion).put("profile", "default").put("genomes", entries)
    if (!embed) manifest.put("external_genomes", true)
    val journal = JSONObject()
        .put("persons", rows(sql, "SELECT * FROM person"))
        .put("relationships", JSONArray().apply { for (r in repo.listRelationships()) put(JSONObject().put("parentId", r.parentId).put("childId", r.childId)) })
        .put("source_files", rows(sql, "SELECT * FROM source_file"))
        .put(
            "consents",
            JSONArray().apply {
                for (r in sql.query("SELECT kind, version, subject, granted_at FROM consent ORDER BY id DESC")) {
                    put(JSONObject().put("kind", r["kind"]).put("version", r["version"]).put("subject", r["subject"]).put("grantedAt", r["granted_at"]))
                }
            },
        )
        .put("health_log", rows(sql, "SELECT * FROM health_log"))
        .put("attachments", rows(sql, "SELECT * FROM attachment"))
        .put("notes", rows(sql, "SELECT * FROM note"))
        .put("chats", rows(sql, "SELECT * FROM chat"))
        .put("sharing_log", rows(sql, "SELECT kind, destination, payload, created_at FROM sharing_log"))
    return Snapshot(Container(header, manifest, journal, genomes), files)
}

private val MAGIC = "HRTH2".toByteArray()

/**
 * Container → bytes (container.ts `serialiseContainer`). `header.json` goes first and stored, so a
 * folder check can read it from the first bytes; genomes are already gzipped and are stored too.
 * With a passphrase the zip is sealed in the `HRTH2` envelope, the header in plain text in front.
 */
fun serialiseContainer(c: Container, passphrase: String? = null): ByteArray {
    val encrypted = !passphrase.isNullOrEmpty()
    val header = JSONObject(c.header.toString()).put("encrypted", encrypted)
    val zip = ByteArrayOutputStream().also { out ->
        ZipOutputStream(out).use { z ->
            fun stored(name: String, bytes: ByteArray) {
                val e = ZipEntry(name).apply {
                    method = ZipEntry.STORED
                    size = bytes.size.toLong()
                    compressedSize = bytes.size.toLong()
                    crc = CRC32().also { it.update(bytes) }.value
                }
                z.putNextEntry(e)
                z.write(bytes)
                z.closeEntry()
            }
            fun deflated(name: String, bytes: ByteArray) {
                z.setLevel(Deflater.DEFAULT_COMPRESSION)
                z.putNextEntry(ZipEntry(name))
                z.write(bytes)
                z.closeEntry()
            }
            stored("header.json", JSONObject(header.toString()).put("encrypted", false).toString().toByteArray())
            deflated("manifest.json", c.manifest.toString().toByteArray())
            deflated("journal.json", c.journal.toString().toByteArray())
            for ((path, bytes) in c.genomes) stored(path, bytes)
        }
    }.toByteArray()
    if (!encrypted) return zip
    val head = header.toString().toByteArray()
    require(head.size <= 0xffff) { "header too large" }
    val random = SecureRandom()
    val salt = ByteArray(16).also(random::nextBytes)
    val nonce = ByteArray(12).also(random::nextBytes)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(pbkdf2Sha256(passphrase!!, salt, 600_000), "AES"), GCMParameterSpec(128, nonce))
    val ct = cipher.doFinal(zip)
    return ByteArrayOutputStream().apply {
        write(MAGIC)
        write(head.size shr 8)
        write(head.size and 0xff)
        write(head)
        write(salt)
        write(nonce)
        write(ct)
    }.toByteArray()
}

/** The whole snapshot with the genomes inside: the manual export. */
fun snapshotBytes(repo: Repo, appVersion: String, passphrase: String? = null): ByteArray =
    serialiseContainer(buildSnapshot(repo, appVersion).container, passphrase)
