package com.hearth.backup

import com.hearth.data.Provider
import com.hearth.data.Repo
import com.hearth.data.Sql
import com.hearth.data.str
import com.hearth.genome.decode
import com.hearth.genome.gunzip
import com.hearth.genome.parseRawText
import com.hearth.genome.sha256Hex
import org.json.JSONArray
import org.json.JSONObject

/**
 * Merges a backup into the database the way frontend/src/export/restore.ts does: `INSERT OR IGNORE`
 * row by row, column names from the allowlists below and never from the file, so restoring the
 * same file twice changes nothing and a file cannot name a column. Genotypes load only for people
 * who have none yet, and an original genome is kept so this phone's own backups ship it too.
 * Attachment bytes travel beside a backup, not in it (attachments/mirror.ts), so their rows arrive
 * without files; [skippedAttachmentFiles] counts them.
 */
data class RestoreResult(
    val persons: Int,
    val healthEntries: Int,
    val genomes: Int,
    val skippedAttachmentFiles: Int,
    val exportedAt: String,
    /** People whose genome file the backup listed but did not carry, and this phone does not have. */
    val missing: List<PersonRef> = emptyList(),
    /** A folder snapshot's genomes that were not beside it: picked on their own, they load later. */
    val elsewhere: List<Elsewhere> = emptyList(),
)

data class PersonRef(val id: String, val name: String)

/**
 * A genome a folder snapshot keeps beside itself. [textSha] is the sha256 of the original's text
 * (its `source_file` row): a copy that reached this phone decompressed, or compressed again, is
 * still known by it.
 */
data class Elsewhere(val entry: GenomeEntry, val name: String, val textSha: String? = null)

private val PERSON_COLS = listOf("id", "label", "display_name", "sex", "birth_year", "birth_date", "notes", "created_at")
private val SOURCE_FILE_COLS = listOf("id", "person_id", "provider", "build", "sha256", "original_name", "row_count", "imported_at")
private val HEALTH_COLS = listOf(
    "id", "person_id", "date", "time", "kind", "title", "body", "source", "body_part", "side", "severity", "tags",
    "value", "value2", "unit", "analyte", "ref_low", "ref_high", "flag", "value_text", "conditions", "details",
    "created_at",
)
private val ATTACHMENT_COLS = listOf("id", "health_log_id", "person_id", "sha256", "mime", "bytes", "name", "created_at")
private val NOTE_COLS = listOf("id", "person_id", "topic", "markdown", "updated_at")
private val CHAT_COLS = listOf("id", "person_ids", "question", "context_pack", "answer", "tier", "created_at")

/** The web's withDefaults(): health rows from older dumps lack the later columns. */
private val HEALTH_DEFAULTS = mapOf<String, Any?>(
    "time" to "", "source" to "", "body_part" to "", "severity" to null, "tags" to "",
    "value" to null, "value2" to null, "unit" to "", "side" to "", "analyte" to "", "ref_low" to null,
    "ref_high" to null, "flag" to "", "value_text" to "", "conditions" to "", "details" to "",
)

/** [onProgress] gets an i18n key from `restore.json` and its placeholders. */
fun restore(
    repo: Repo,
    c: Container,
    onProgress: (String, Map<String, Any>) -> Unit = { _, _ -> },
    /** Fetches a genome a folder snapshot keeps beside itself; null when the place does not have it (yet). */
    loadGenome: (GenomeEntry) -> ByteArray? = { null },
): RestoreResult = repo.sql.transaction {
    val sql = repo.sql
    val j = c.journal
    val hadGenotypes = sql.query("SELECT DISTINCT person_id FROM genotype").map { it.str("person_id") }.toSet()
    val mark = repo.totalChanges()
    val personsBefore = count(sql, "person")
    val healthBefore = count(sql, "health_log")
    // birth_date came later: an older dump's people have none, and NOT NULL would skip them.
    insertRows(sql, "person", PERSON_COLS, rows(j, "persons").map { mapOf("birth_date" to "") + it })
    for (r in rows(j, "relationships"))
        sql.exec("INSERT OR IGNORE INTO relationship(parent_id, child_id) VALUES (?,?)", listOf(r["parentId"], r["childId"]))
    insertRows(sql, "source_file", SOURCE_FILE_COLS, rows(j, "source_files"))
    insertRows(sql, "health_log", HEALTH_COLS, rows(j, "health_log").map { HEALTH_DEFAULTS + it })
    // ON CONFLICT does not cover foreign keys: an orphan row from a damaged file would throw.
    val attachments = rows(j, "attachments")
    for (a in attachments) {
        sql.exec(
            "INSERT OR IGNORE INTO attachment(${ATTACHMENT_COLS.joinToString(",")}) SELECT ${ATTACHMENT_COLS.joinToString(",") { "?" }} WHERE EXISTS (SELECT 1 FROM health_log WHERE id = ?)",
            ATTACHMENT_COLS.map { a[it] } + listOf(a["health_log_id"]),
        )
    }
    insertRows(sql, "note", NOTE_COLS, rows(j, "notes"))
    insertRows(sql, "chat", CHAT_COLS, rows(j, "chats"))
    for (r in rows(j, "consents")) {
        if (r["revokedAt"] != null || r["revoked_at"] != null) continue // dumps from before revoke-is-delete
        val kind = r["kind"]
        val version = r["version"]
        val subject = r["subject"] ?: ""
        sql.exec(
            "INSERT INTO consent(kind,version,subject,granted_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM consent WHERE kind=? AND version=? AND subject=?)",
            listOf(kind, version, subject, r["grantedAt"] ?: r["granted_at"], kind, version, subject),
        )
    }
    for (s in rows(j, "sharing_log")) {
        sql.exec(
            "INSERT INTO sharing_log(kind,destination,payload,created_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM sharing_log WHERE kind=? AND destination=? AND created_at=?)",
            listOf(s["kind"], s["destination"], s["payload"], s["created_at"], s["kind"], s["destination"], s["created_at"]),
        )
    }
    repo.touch(since = mark)
    val entries = c.genomeEntries
    var genomes = 0
    val missing = linkedSetOf<String>()
    val elsewhere = mutableListOf<GenomeEntry>()
    for (g in entries) {
        if (g.personId in hadGenotypes) continue
        var gz: ByteArray? = c.genomes[g.path]
        if (gz == null && c.external) {
            onProgress("restore.fetchingGenome", mapOf("n" to genomes + 1, "total" to entries.size))
            // Not in the folder yet (another device is still uploading it): this person keeps no
            // genotypes for now, and the next load, which skips people who have them, tries again.
            val fetched = loadGenome(g)
            if (fetched == null) {
                elsewhere.add(g)
                continue
            }
            if (sha256Hex(fetched) == g.sha256) gz = fetched
        }
        if (gz == null) {
            missing.add(g.personId)
            continue
        }
        restoreGenome(repo, g, gz, onProgress, genomes + 1, entries.size)
        genomes++
    }
    val people = rows(j, "persons")
    fun name(id: String): String {
        val p = people.firstOrNull { it["id"] == id } ?: return id
        return (p["display_name"] as? String).orEmpty().ifEmpty { p["label"] as? String ?: id }
    }
    val sources = rows(j, "source_files")
    RestoreResult(
        persons = count(sql, "person") - personsBefore,
        healthEntries = count(sql, "health_log") - healthBefore,
        genomes = genomes,
        skippedAttachmentFiles = attachments.size,
        exportedAt = c.header.optString("exported_at"),
        missing = missing.map { PersonRef(it, name(it)) },
        elsewhere = elsewhere.map { g ->
            Elsewhere(g, name(g.personId), sources.firstOrNull { it["id"] == g.sourceFileId }?.get("sha256") as? String)
        },
    )
}

/**
 * One genome file (gzipped raw text, already checked against its manifest entry) into the person's
 * genotypes. The original is kept so this phone's own backups ship it too.
 */
fun restoreGenome(
    repo: Repo,
    g: GenomeEntry,
    gz: ByteArray,
    onProgress: (String, Map<String, Any>) -> Unit,
    n: Int,
    total: Int,
) {
    val text = decode(gunzip(gz))
    onProgress("restore.parsingGenome", mapOf("n" to n, "total" to total))
    val r = parseRawText(text, if (g.original) Provider.of(g.provider) else Provider.GENERIC)
    onProgress("restore.storingCalls", mapOf("n" to r.calls.size))
    repo.storeCalls(g.personId, r.calls)
    if (g.original) repo.blobs.put(Repo.genomeBlobName(sha256Hex(text)), gz)
}

private fun insertRows(sql: Sql, table: String, cols: List<String>, rows: List<Map<String, Any?>>) {
    val statement = "INSERT OR IGNORE INTO $table(${cols.joinToString(",")}) VALUES (${cols.joinToString(",") { "?" }})"
    for (r in rows) sql.exec(statement, cols.map { r[it] })
}

private fun count(sql: Sql, table: String): Int = (sql.query("SELECT COUNT(*) AS n FROM $table").first()["n"] as Number).toInt()

/** A journal array as plain rows: JSON null becomes null, nested values are not expected. */
private fun rows(journal: JSONObject, key: String): List<Map<String, Any?>> {
    val a: JSONArray = journal.optJSONArray(key) ?: return emptyList()
    return (0 until a.length()).mapNotNull { i ->
        val o = a.optJSONObject(i) ?: return@mapNotNull null
        o.keys().asSequence().associateWith { k -> o.opt(k).takeUnless { it == JSONObject.NULL } }
    }
}

/**
 * Any Hearth backup this app reads (restore.ts `restoreBytes`): dump v2, plain or sealed, or an
 * older dump v1. Throws [BackupException] naming the message to show.
 */
fun restoreBytes(
    repo: Repo,
    bytes: ByteArray,
    passphrase: String?,
    onProgress: (String, Map<String, Any>) -> Unit = { _, _ -> },
    loadGenome: (GenomeEntry) -> ByteArray? = { null },
): RestoreResult =
    if (isV1(bytes)) restoreV1(repo, openV1(bytes, passphrase)) else restore(repo, openContainer(bytes, passphrase), onProgress, loadGenome)

/**
 * After a repair (Db.repair) every person is without genotypes, but the genome files kept beside
 * the database survived it: each person's latest original (`genome-<sha>.gz`, named by its
 * source_file row) or, for someone imported before originals were kept, the rebuilt copy
 * (`generic-<person>-<rows>.gz`). Returns how many people got their genotypes back.
 */
fun rebuildGenomesFromCache(repo: Repo, onProgress: (String, Map<String, Any>) -> Unit = { _, _ -> }): Int {
    val people = repo.sql.query("SELECT p.id FROM person p WHERE NOT EXISTS (SELECT 1 FROM genotype g WHERE g.person_id = p.id)").map { it.str("id") }
    val cached = repo.blobs.list()
    var n = 0
    for ((i, id) in people.withIndex()) {
        val sf = repo.sql.query("SELECT id, provider, build, sha256 FROM source_file WHERE person_id = ? ORDER BY imported_at DESC LIMIT 1", listOf(id)).firstOrNull()
        val original = sf?.let { repo.blobs.get(Repo.genomeBlobName(it.str("sha256"))) }
        val rebuilt = if (original == null) cached.firstOrNull { it.startsWith("generic-$id-") } else null
        val gz = original ?: rebuilt?.let { repo.blobs.get(it) } ?: continue
        val entry = if (original != null && sf != null) GenomeEntry("", "", id, sf.str("provider"), true, sf.str("id")) else GenomeEntry("", "", id, "generic", false)
        restoreGenome(repo, entry, gz, onProgress, i + 1, people.size)
        n++
    }
    return n
}
