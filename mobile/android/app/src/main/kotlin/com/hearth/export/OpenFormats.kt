package com.hearth.export

import com.hearth.data.HealthEntry
import com.hearth.data.Person
import com.hearth.data.Sql
import com.hearth.health.jsNumber
import com.hearth.kb.Finding
import java.time.LocalDate

/**
 * Open formats for the user's own analysis (export/table.ts, docs/architecture/storage/open-formats.md):
 * CSV for spreadsheets, JSON Lines for scripts, written the way the web writes them, so a file
 * from the phone and one from the browser are the same bytes for the same data.
 */
enum class OpenFormat(val ext: String, val mime: String) { CSV("csv", "text/csv"), JSONL("jsonl", "application/x-ndjson") }

/** A cell: text, a number (printed as JavaScript prints it) or empty. */
typealias Cell = Any?

private fun cellText(v: Cell): String = when (v) {
    null -> ""
    is Double -> jsNumber(v)
    is Float -> jsNumber(v.toDouble())
    else -> v.toString()
}

private val NEEDS_QUOTES = Regex("[\",\\r\\n]|^\\s|\\s$")

/** RFC 4180 quoting: quote when the value has a comma, quote, newline or leading/trailing space. */
fun csvCell(v: Cell): String {
    if (v == null) return ""
    val s = cellText(v)
    return if (NEEDS_QUOTES.containsMatchIn(s)) "\"" + s.replace("\"", "\"\"") + "\"" else s
}

fun csvLine(cells: List<Cell>) = cells.joinToString(",") { csvCell(it) }

/** UTF-8 BOM so Excel opens accented text correctly. */
const val CSV_BOM = "\uFEFF"

/** A value as JSON.stringify writes it: numbers the JavaScript way, strings with its escapes. */
fun jsonValue(v: Cell): String = when (v) {
    null -> "null"
    is Number -> cellText(if (v is Int || v is Long) v else v.toDouble())
    is Boolean -> v.toString()
    else -> buildString {
        append('"')
        for (c in v.toString()) when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            '\b' -> append("\\b")
            '\u000C' -> append("\\f")
            else -> if (c < ' ') append("\\u%04x".format(c.code)) else append(c)
        }
        append('"')
    }
}

class Table(val header: List<String>, val rows: List<List<Cell>>)

fun render(t: Table, format: OpenFormat): String = when (format) {
    OpenFormat.CSV -> CSV_BOM + (listOf(csvLine(t.header)) + t.rows.map(::csvLine)).joinToString("\n") + "\n"
    OpenFormat.JSONL -> t.rows.joinToString("") { r -> "{" + t.header.indices.joinToString(",") { jsonValue(t.header[it]) + ":" + jsonValue(r[it]) } + "}\n" }
}

/** Column names: the person's short label, made unique with a numeric suffix. */
fun personColumns(persons: List<Person>): List<Pair<String, String>> {
    val seen = HashMap<String, Int>()
    return persons.map { p ->
        val base = p.label.ifEmpty { p.displayName.ifEmpty { p.id.take(8) } }
        val n = seen[base] ?: 0
        seen[base] = n + 1
        p.id to if (n == 0) base else "$base-${n + 1}"
    }
}

val FINDING_HEADER = listOf(
    "person", "rsid", "gene", "name", "genotype", "risk_allele", "risk_copies", "magnitude", "label", "evidence", "topic",
    "conditions", "drugs", "summary", "sources",
)

fun findingsTable(byPerson: List<Pair<Person, List<Finding>>>): Table = Table(
    FINDING_HEADER,
    byPerson.flatMap { (person, findings) ->
        findings.map { f ->
            listOf(
                person.displayName, f.entry.rsid, f.entry.gene, f.entry.name, f.genotype, f.entry.riskAllele, f.riskCopies,
                f.match?.magnitude, f.match?.label ?: "", f.entry.evidence, f.entry.topic, f.entry.conditions.joinToString("; "),
                f.entry.drugs.joinToString("; "), f.entry.summary, f.entry.sources.joinToString(" "),
            )
        }
    },
)

val HEALTH_HEADER = listOf(
    "person", "date", "time", "kind", "title", "body_part", "severity", "value", "value2", "unit", "tags", "source", "body",
    // How many documents are attached, never their names: this file is plain text by design.
    "attachments", "created_at",
)

fun healthTable(byPerson: List<Pair<Person, List<HealthEntry>>>, attachmentCounts: Map<String, Int> = emptyMap()): Table = Table(
    HEALTH_HEADER,
    byPerson.flatMap { (person, entries) ->
        entries.map { e ->
            listOf(
                person.displayName, e.date, e.time, e.kind.id, e.title, e.bodyPart, e.severity, e.value, e.value2, e.unit,
                e.tags.joinToString("; "), e.source, e.body, attachmentCounts[e.id] ?: 0, e.createdAt,
            )
        }
    },
)

/**
 * One row per SNP, one genotype column per person (db.worker.ts `genotypeTable`), ordered by
 * chromosome number then position; with [shared] only SNPs every listed person has a call for.
 */
fun genotypeTable(sql: Sql, columns: List<Pair<String, String>>, shared: Boolean): Table {
    val ids = columns.map { it.first }
    val cases = columns.indices.joinToString("") { ", MAX(CASE WHEN person_id = ? THEN a1 || a2 END) AS g$it" }
    val rows = sql.query(
        """SELECT rsid, chromosome, position$cases FROM genotype
           WHERE person_id IN (${ids.joinToString(",") { "?" }.ifEmpty { "''" }}) GROUP BY rsid
           ${if (shared) "HAVING COUNT(*) = ${columns.size}" else ""}
           ORDER BY CASE WHEN chromosome GLOB '[0-9]*' THEN CAST(chromosome AS INTEGER) ELSE 100 END, chromosome, position""",
        ids + ids,
    )
    return Table(
        listOf("rsid", "chromosome", "position") + columns.map { it.second },
        rows.map { r -> listOf<Cell>(r["rsid"], r["chromosome"], r["position"]) + columns.indices.map { r["g$it"] } },
    )
}

fun openFileName(what: String, format: OpenFormat) = "hearth-$what-${LocalDate.now()}.${format.ext}"
