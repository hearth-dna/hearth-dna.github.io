package com.hearth.data

import com.hearth.backup.Container
import com.hearth.backup.RestoreResult
import com.hearth.health.formatTags
import com.hearth.health.normTime
import com.hearth.health.parseTags
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * The queries the native screens make, written to store exactly what frontend/src/db/repo.ts
 * stores: same ids, timestamps, tag encoding and consent rows, so a backup reads the same whichever
 * app wrote it.
 */
class Repo(val sql: Sql, val blobs: Blobs) {

    // ---- persons ------------------------------------------------------------------------------

    fun listPersons(): List<Person> = sql.query("SELECT * FROM person ORDER BY created_at").map {
        Person(
            id = it.str("id"),
            label = it.str("label"),
            displayName = it.str("display_name"),
            sex = it.str("sex"),
            birthYear = it.long("birth_year")?.toInt(),
            notes = it.str("notes"),
            createdAt = it.str("created_at"),
        )
    }

    fun addPerson(label: String, displayName: String, sex: Sex, birthYear: Int?): Person {
        val p = Person(newId(), label, displayName, sex.id, birthYear, "", now())
        sql.transaction {
            sql.exec(
                "INSERT INTO person(id,label,display_name,sex,birth_year,notes,created_at) VALUES (?,?,?,?,?,?,?)",
                listOf(p.id, p.label, p.displayName, p.sex, p.birthYear, p.notes, p.createdAt),
            )
            touch()
        }
        return p
    }

    fun updatePerson(id: String, displayName: String, sex: Sex, birthYear: Int?) = sql.transaction {
        sql.exec("UPDATE person SET display_name=?, sex=?, birth_year=? WHERE id=?", listOf(displayName, sex.id, birthYear, id))
        touch()
    }

    /** Their genotypes, entries and links go too (ON DELETE CASCADE); then the files nothing needs. */
    fun deletePerson(id: String) {
        sql.transaction {
            sql.exec("DELETE FROM person WHERE id = ?", listOf(id))
            touch(genotypes = true)
        }
        pruneBlobs()
    }

    // ---- pedigree -----------------------------------------------------------------------------

    fun setParent(parentId: String, childId: String) = sql.transaction {
        sql.exec("INSERT OR IGNORE INTO relationship(parent_id, child_id) VALUES (?,?)", listOf(parentId, childId))
        touch()
    }

    fun unsetParent(parentId: String, childId: String) = sql.transaction {
        sql.exec("DELETE FROM relationship WHERE parent_id=? AND child_id=?", listOf(parentId, childId))
        touch()
    }

    fun listRelationships(): List<Relationship> =
        sql.query("SELECT parent_id, child_id FROM relationship").map { Relationship(it.str("parent_id"), it.str("child_id")) }

    // ---- genotypes ----------------------------------------------------------------------------

    fun importCalls(personId: String, provider: Provider, build: String, sha256: String, originalName: String, calls: List<Call>, onProgress: (Int) -> Unit = {}): SourceFile {
        val sf = SourceFile(newId(), personId, provider, build, sha256, originalName, calls.size, now())
        sql.transaction {
            storeCalls(personId, calls, onProgress)
            insertSourceFile(sf)
        }
        return sf
    }

    /**
     * Genotype rows only; the source_file row is the caller's business (a restore keeps the
     * original's). Sorted by the primary key and with the rsid index dropped for the duration, as
     * the web does: appends instead of random B-tree inserts, seconds instead of minutes.
     */
    fun storeCalls(personId: String, calls: List<Call>, onProgress: (Int) -> Unit = {}) = sql.transaction {
        val mark = totalChanges()
        sql.exec("DROP INDEX IF EXISTS genotype_rsid")
        sql.insertMany(
            "INSERT OR REPLACE INTO genotype(person_id,rsid,chromosome,position,a1,a2) VALUES (?,?,?,?,?,?)",
            calls.sortedBy { it.rsid }.map { listOf(personId, it.rsid, it.chromosome, it.position, it.a1, it.a2) },
            onProgress,
        )
        sql.exec("CREATE INDEX IF NOT EXISTS genotype_rsid ON genotype(rsid)")
        touch(genotypes = true, since = mark)
    }

    fun insertSourceFile(sf: SourceFile) = sql.transaction {
        sql.exec(
            "INSERT OR IGNORE INTO source_file(id,person_id,provider,build,sha256,original_name,row_count,imported_at) VALUES (?,?,?,?,?,?,?,?)",
            listOf(sf.id, sf.personId, sf.provider.id, sf.build, sf.sha256, sf.originalName, sf.rowCount, sf.importedAt),
        )
        touch()
    }

    fun listSourceFiles(): List<SourceFile> = sql.query("SELECT * FROM source_file ORDER BY imported_at").map {
        SourceFile(
            id = it.str("id"),
            personId = it.str("person_id"),
            provider = Provider.of(it.str("provider")),
            build = it.str("build"),
            sha256 = it.str("sha256"),
            originalName = it.str("original_name"),
            rowCount = it.long("row_count")?.toInt() ?: 0,
            importedAt = it.str("imported_at"),
        )
    }

    /**
     * Genotype rows per person. Counting scans every row, so the result is kept in meta until a
     * write to the genotype table or a person delete drops it ([touch]); counting and storing is
     * one statement, so no write slips in between.
     */
    fun genotypeCounts(): Map<String, Int> {
        getMeta("genotype_counts")?.let { return parseCounts(it) }
        sql.exec(
            "INSERT OR REPLACE INTO meta(key, value) SELECT 'genotype_counts', json_group_object(person_id, n) FROM (SELECT person_id, COUNT(*) AS n FROM genotype GROUP BY person_id)",
        )
        return parseCounts(getMeta("genotype_counts") ?: "{}")
    }

    private fun parseCounts(json: String): Map<String, Int> {
        val o = org.json.JSONObject(json)
        return o.keys().asSequence().associateWith { o.getInt(it) }
    }

    /** One rsid across everyone (the `family_all` query). */
    fun familyAt(rsid: String): List<FamilyCall> =
        sql.query("SELECT person_id, rsid, chromosome, position, a1, a2 FROM genotype WHERE rsid = ?", listOf(rsid.trim())).map(::toFamilyCall)

    fun familyAtMany(rsids: List<String>): List<FamilyCall> = rsids.chunked(500).flatMap { slice ->
        sql.query(
            "SELECT person_id, rsid, chromosome, position, a1, a2 FROM genotype WHERE rsid IN (${slice.joinToString(",") { "?" }})",
            slice,
        ).map(::toFamilyCall)
    }

    /** One person's calls at a list of rsids (kb markers, ask context), fast through the key. */
    fun personCallsFor(personId: String, rsids: List<String>): List<Call> = rsids.chunked(500).flatMap { slice ->
        sql.query(
            "SELECT rsid, chromosome, position, a1, a2 FROM genotype WHERE person_id = ? AND rsid IN (${slice.joinToString(",") { "?" }})",
            listOf(personId) + slice,
        ).map(::toCall)
    }

    /** Every call for one person, for export. Hundreds of thousands of rows. */
    fun personCalls(personId: String): List<Call> =
        sql.query("SELECT rsid, chromosome, position, a1, a2 FROM genotype WHERE person_id = ? ORDER BY chromosome, position", listOf(personId)).map(::toCall)

    /**
     * Mendelian consistency inside SQLite, the web's `mendelianSql`: autosomes only, no-calls
     * excluded. With one parent a child needs one allele in common; with two, one from each.
     */
    fun mendelian(childId: String, parentA: String, parentB: String? = null): Mendelian {
        val autosomal = "c.chromosome NOT IN ('X','Y','XY','MT') AND c.a1 <> '-' AND c.a2 <> '-'"
        val row = if (parentB != null) sql.query(
            """SELECT COUNT(*) AS compared,
                      SUM(CASE WHEN ((c.a1 IN (p.a1,p.a2) AND c.a2 IN (q.a1,q.a2)) OR (c.a2 IN (p.a1,p.a2) AND c.a1 IN (q.a1,q.a2))) THEN 0 ELSE 1 END) AS violations
               FROM genotype c
               JOIN genotype p ON p.rsid = c.rsid AND p.person_id = ?
               JOIN genotype q ON q.rsid = c.rsid AND q.person_id = ?
               WHERE c.person_id = ? AND $autosomal AND p.a1 <> '-' AND p.a2 <> '-' AND q.a1 <> '-' AND q.a2 <> '-'""",
            listOf(parentA, parentB, childId),
        ).firstOrNull() else sql.query(
            """SELECT COUNT(*) AS compared,
                      SUM(CASE WHEN (c.a1 IN (p.a1,p.a2) OR c.a2 IN (p.a1,p.a2)) THEN 0 ELSE 1 END) AS violations
               FROM genotype c
               JOIN genotype p ON p.rsid = c.rsid AND p.person_id = ?
               WHERE c.person_id = ? AND $autosomal AND p.a1 <> '-' AND p.a2 <> '-'""",
            listOf(parentA, childId),
        ).firstOrNull()
        return Mendelian(row?.long("compared")?.toInt() ?: 0, row?.long("violations")?.toInt() ?: 0)
    }

    private fun toCall(r: Row) = Call(r.str("rsid"), r.str("chromosome"), r.long("position") ?: 0, r.str("a1"), r.str("a2"))

    private fun toFamilyCall(r: Row) = FamilyCall(r.str("person_id"), toCall(r))

    // ---- files next to the database -----------------------------------------------------------

    /**
     * Drops cached files nothing refers to any more (after a delete, revoke, erase or re-import):
     * genome originals, rebuilt genomes and attached documents. The whole keep-set is built before
     * the first delete, so a failing query aborts the sweep instead of deleting against half a set.
     */
    fun pruneBlobs() {
        val keep = HashSet<String>()
        listSourceFiles().forEach { keep.add(genomeBlobName(it.sha256)) }
        genotypeCounts().forEach { (pid, n) -> keep.add(rebuiltBlobName(pid, n)) }
        sql.query("SELECT DISTINCT sha256 FROM attachment").forEach { keep.add(attachmentBlobName(it.str("sha256"))) }
        for (name in blobs.list()) {
            if (PRUNABLE.containsMatchIn(name) && name !in keep) blobs.delete(name)
        }
    }

    // ---- attachments ---------------------------------------------------------------------------

    fun insertAttachment(a: Attachment) = sql.transaction {
        sql.exec(
            "INSERT INTO attachment(id,health_log_id,person_id,sha256,mime,bytes,name,created_at) VALUES (?,?,?,?,?,?,?,?)",
            listOf(a.id, a.healthLogId, a.personId, a.sha256, a.mime, a.bytes, a.name, a.createdAt),
        )
        touch()
    }

    /** The row, then any file no other row still refers to. */
    fun deleteAttachment(id: String) {
        sql.transaction {
            sql.exec("DELETE FROM attachment WHERE id=?", listOf(id))
            touch()
        }
        pruneBlobs()
    }

    /** The bytes all attached documents take, each distinct file once. */
    fun attachmentBytesTotal(): Long =
        sql.query("SELECT COALESCE(SUM(bytes), 0) AS n FROM (SELECT sha256, MAX(bytes) AS bytes FROM attachment GROUP BY sha256)").first().long("n") ?: 0

    // ---- sharing log ---------------------------------------------------------------------------

    /**
     * A context pack copied out (AskPage.tsx `copy`): the pack in the sharing log, where Settings
     * shows it, and the question with its pack in `chat`, in one transaction.
     */
    fun recordCopyOut(destination: String, personIds: List<String>, question: String, pack: String) = sql.transaction {
        sql.exec("INSERT INTO sharing_log(kind,destination,payload,created_at) VALUES (?,?,?,?)", listOf("copy-out", destination, pack, now()))
        touch()
        sql.exec(
            "INSERT INTO chat(id,person_ids,question,context_pack,tier,created_at) VALUES (?,?,?,?,?,?)",
            listOf(newId(), personIds.joinToString(","), question, pack, "copy-out", now()),
        )
        touch()
    }

    /** One send to a provider, metadata only (ReadDocumentDialog.tsx: never the file). */
    fun logSharing(kind: String, destination: String, payload: String) = sql.transaction {
        sql.exec("INSERT INTO sharing_log(kind,destination,payload,created_at) VALUES (?,?,?,?)", listOf(kind, destination, payload, now()))
        touch()
    }

    /** Bookkeeping, not user data: no generation bump. null or "" removes the key (repo.ts `setMeta`). */
    fun setMeta(key: String, value: String?) {
        if (value.isNullOrEmpty()) sql.exec("DELETE FROM meta WHERE key=?", listOf(key))
        else sql.exec("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)", listOf(key, value))
    }

    fun getMeta(key: String): String? = sql.query("SELECT value FROM meta WHERE key=?", listOf(key)).firstOrNull()?.strOrNull("value")

    /** Every person's entries, newest first. */
    fun listHealthLog(): List<HealthEntry> =
        sql.query("SELECT * FROM health_log ORDER BY date DESC, time DESC, created_at DESC").map(::toEntry)

    fun addHealthEntry(e: NewHealthEntry): HealthEntry {
        val entry = HealthEntry(
            id = newId(),
            personId = e.personId,
            date = e.date,
            time = normTime(e.time),
            kind = e.kind,
            title = e.title,
            body = e.body,
            source = e.source,
            bodyPart = e.bodyPart.trim().lowercase(),
            severity = e.severity,
            tags = parseTags(formatTags(e.tags)),
            value = e.value,
            value2 = e.value2,
            unit = e.unit.trim(),
            createdAt = now(),
        )
        sql.transaction {
            sql.exec(
                "INSERT INTO health_log(id,person_id,date,time,kind,title,body,source,body_part,severity,tags,value,value2,unit,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                listOf(
                    entry.id, entry.personId, entry.date, entry.time, entry.kind.id, entry.title, entry.body,
                    entry.source, entry.bodyPart, entry.severity, formatTags(entry.tags), entry.value,
                    entry.value2, entry.unit, entry.createdAt,
                ),
            )
            touch()
        }
        return entry
    }

    /** The attachment rows go with the entry (ON DELETE CASCADE); their files need collecting. */
    fun deleteHealthEntry(id: String) {
        sql.transaction {
            sql.exec("DELETE FROM health_log WHERE id=?", listOf(id))
            touch()
        }
        pruneBlobs()
    }

    /** Each entry's attached documents (metadata only), keyed by entry id. */
    fun attachmentsByEntry(): Map<String, List<Attachment>> =
        sql.query("SELECT * FROM attachment ORDER BY created_at").map {
            Attachment(
                id = it.str("id"),
                healthLogId = it.str("health_log_id"),
                personId = it.str("person_id"),
                sha256 = it.str("sha256"),
                mime = it.str("mime"),
                bytes = it.long("bytes") ?: 0,
                name = it.str("name"),
                createdAt = it.str("created_at"),
            )
        }.groupBy { it.healthLogId }

    fun hasConsent(kind: ConsentKind, subject: String = ""): Boolean = sql.query(
        "SELECT 1 AS ok FROM consent WHERE kind=? AND version=? AND subject=? AND revoked_at IS NULL LIMIT 1",
        listOf(kind.id, kind.version, subject),
    ).isNotEmpty()

    fun grantConsent(kind: ConsentKind, subject: String = "") = sql.transaction {
        if (!hasConsent(kind, subject)) {
            sql.exec(
                "INSERT INTO consent(kind,version,subject,granted_at) VALUES (?,?,?,?)",
                listOf(kind.id, kind.version, subject, now()),
            )
            touch()
        }
    }

    /** Merges a backup into this database (see [com.hearth.backup.restore]). */
    fun restore(c: Container, onProgress: (String, Map<String, Any>) -> Unit = { _, _ -> }): RestoreResult =
        com.hearth.backup.restore(this, c, onProgress)

    /**
     * A write that changed rows bumps meta.generation, which backups use to tell snapshots apart; a
     * write that can change how many genotypes someone has also drops the cached counts. The web
     * worker's rule, applied right after the write inside its transaction: `changes()` is the rows
     * the last statement touched, or, with [since], everything since that `total_changes()` mark.
     */
    internal fun touch(genotypes: Boolean = false, since: Long? = null) {
        val changed = if (since != null) totalChanges() > since else (sql.query("SELECT changes() AS n").first().long("n") ?: 0) > 0
        if (!changed) return
        sql.exec("INSERT INTO meta(key, value) VALUES ('generation', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1")
        if (genotypes) sql.exec("DELETE FROM meta WHERE key = 'genotype_counts'")
    }

    internal fun totalChanges(): Long = sql.query("SELECT total_changes() AS n").first().long("n") ?: 0

    private fun toEntry(r: Row) = HealthEntry(
        id = r.str("id"),
        personId = r.str("person_id"),
        date = r.str("date"),
        time = normTime(r.str("time")),
        kind = HealthKind.of(r.str("kind")),
        title = r.str("title"),
        body = r.str("body"),
        source = r.str("source"),
        bodyPart = r.str("body_part"),
        severity = r.long("severity")?.toInt(),
        tags = parseTags(r.str("tags")),
        value = r.double("value"),
        value2 = r.double("value2"),
        unit = r.str("unit"),
        createdAt = r.str("created_at"),
    )

    companion object {
        private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

        /** Same form as the web's crypto.randomUUID(). */
        fun newId(): String = UUID.randomUUID().toString()

        /** Same form as the web's Date.toISOString(): UTC, milliseconds. */
        fun now(): String = ISO.format(Instant.now())

        /** Where the gzipped original of a source file is kept (dump v2). */
        fun genomeBlobName(sha256OfText: String) = "genome-$sha256OfText.gz"

        /** A genome rebuilt for export from someone imported before originals were kept. */
        fun rebuiltBlobName(personId: String, rows: Int) = "generic-$personId-$rows.gz"

        /** An attached document's bytes (attachments/file.ts). */
        fun attachmentBlobName(sha256: String) = "att-$sha256.bin"

        private val PRUNABLE = Regex("^(genome-|generic-|att-)")
    }
}

/** What the add form collects; the repository fills in id, source and created_at. */
data class NewHealthEntry(
    val personId: String,
    val date: String,
    val time: String,
    val kind: HealthKind,
    val title: String,
    val body: String,
    val bodyPart: String,
    val severity: Int?,
    val tags: List<String>,
    val value: Double?,
    val value2: Double?,
    val unit: String,
    /** "" when typed; `gemini:<model>:<sha256 of the files>` when a model transcribed it. */
    val source: String = "",
)

/**
 * Every consent the app can ask for, with the web's versions and statement counts
 * (frontend/src/consent/kinds.ts). A record for an older version does not count, so these must move
 * with the web's.
 */
enum class ConsentKind(val id: String, val version: Int, val statements: Int) {
    FIRST_LAUNCH("first_launch", 1, 4),
    IMPORT_GENOME("import_genome", 1, 3),
    IMPORT_MINOR("import_minor", 1, 2),
    IMPORT_DOCUMENT("import_document", 1, 1),
    TIER3_BYOK("tier3_byok", 1, 3),
    READ_DOCUMENT_BYOK("read_document_byok", 1, 3),
    BACKUP_FOLDER("backup_folder", 1, 3),
    CLOUD_BACKUP("cloud_backup", 3, 3),
    ;

    /** i18n key of the heading (`consent.json`). */
    val titleKey get() = "consent.$id.title"

    /** i18n keys of the statements, one confirmation each. */
    val statementKeys get() = (1..statements).map { "consent.$id.statement$it" }
}
