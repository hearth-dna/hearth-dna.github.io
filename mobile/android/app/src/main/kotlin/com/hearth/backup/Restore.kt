package com.hearth.backup

import com.hearth.data.Sql
import org.json.JSONArray
import org.json.JSONObject

/**
 * Merges a backup's journal into the database the way frontend/src/export/restore.ts does:
 * `INSERT OR IGNORE` row by row, column names from the allowlists below and never from the file,
 * so restoring the same file twice changes nothing and a file cannot name a column. Genomes and
 * attachment bytes are left for later slices (ADR 0010) and counted as skipped.
 */
data class RestoreResult(
    val persons: Int,
    val healthEntries: Int,
    val skippedGenomes: Int,
    val skippedAttachmentFiles: Int,
)

private val PERSON_COLS = listOf("id", "label", "display_name", "sex", "birth_year", "notes", "created_at")
private val SOURCE_FILE_COLS = listOf("id", "person_id", "provider", "build", "sha256", "original_name", "row_count", "imported_at")
private val HEALTH_COLS = listOf(
    "id", "person_id", "date", "time", "kind", "title", "body", "source", "body_part", "severity", "tags",
    "value", "value2", "unit", "created_at",
)
private val ATTACHMENT_COLS = listOf("id", "health_log_id", "person_id", "sha256", "mime", "bytes", "name", "created_at")
private val NOTE_COLS = listOf("id", "person_id", "topic", "markdown", "updated_at")
private val CHAT_COLS = listOf("id", "person_ids", "question", "context_pack", "answer", "tier", "created_at")

/** The web's withDefaults(): health rows from older dumps lack the later columns. */
private val HEALTH_DEFAULTS = mapOf<String, Any?>(
    "time" to "", "source" to "", "body_part" to "", "severity" to null, "tags" to "",
    "value" to null, "value2" to null, "unit" to "",
)

fun restore(sql: Sql, c: Container): RestoreResult = sql.transaction {
    val j = c.journal
    val personsBefore = count(sql, "person")
    val healthBefore = count(sql, "health_log")
    insertRows(sql, "person", PERSON_COLS, rows(j, "persons"))
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
    sql.exec(
        "INSERT INTO meta(key, value) VALUES ('generation', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1",
    )
    RestoreResult(
        persons = count(sql, "person") - personsBefore,
        healthEntries = count(sql, "health_log") - healthBefore,
        skippedGenomes = c.manifest.optJSONArray("genomes")?.length() ?: 0,
        skippedAttachmentFiles = attachments.size,
    )
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
