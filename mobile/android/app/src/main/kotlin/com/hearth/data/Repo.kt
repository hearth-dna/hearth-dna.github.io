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
class Repo(private val sql: Sql) {

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
            source = "",
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

    /** The attachment rows go with the entry (ON DELETE CASCADE). */
    fun deleteHealthEntry(id: String) = sql.transaction {
        sql.exec("DELETE FROM health_log WHERE id=?", listOf(id))
        touch()
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
    fun restore(c: Container): RestoreResult = com.hearth.backup.restore(sql, c)

    /** Every user-data write bumps meta.generation, which backups use to tell snapshots apart. */
    private fun touch() = sql.exec(
        "INSERT INTO meta(key, value) VALUES ('generation', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1",
    )

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
