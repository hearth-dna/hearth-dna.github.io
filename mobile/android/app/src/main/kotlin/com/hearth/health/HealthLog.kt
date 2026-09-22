package com.hearth.health

import com.hearth.data.HealthEntry
import com.hearth.data.HealthKind
import java.text.Collator
import java.time.LocalDate

/**
 * Port of frontend/src/health/log.ts: tag encoding, value formatting, filtering, sorting and
 * grouping for the health log. Kept function for function with the web so the two behave alike;
 * HealthLogTest mirrors log.test.ts.
 */

/** "Arthritis, flare ,,Flare" → [arthritis, flare]: lower-case, trimmed, de-duplicated, in order. */
fun parseTags(text: String): List<String> =
    text.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }.distinct()

/** Inverse of [parseTags]; what the `tags` column stores. */
fun formatTags(tags: List<String>): String = tags.joinToString(", ")

/** "8:05" → "08:05"; anything that is not a valid 24-hour HH:MM (or H:MM) becomes "". */
fun normTime(s: String): String {
    val m = Regex("""^(\d{1,2}):(\d{2})(?::\d{2})?$""").find(s.trim()) ?: return ""
    val (h, min) = m.destructured
    if (h.toInt() > 23 || min.toInt() > 59) return ""
    return "${h.padStart(2, '0')}:$min"
}

/** Today as a local YYYY-MM-DD. */
fun localDate(): String = LocalDate.now().toString()

/** The YYYY-MM-DD `days` calendar days before `date`. */
fun daysBefore(date: String, days: Long): String = LocalDate.parse(date).minusDays(days).toString()

/** "2026-09-14 08:05", or just the date when no time was recorded. */
fun whenOf(e: HealthEntry): String = if (e.time.isNotEmpty()) "${e.date} ${e.time}" else e.date

/** A number the way JavaScript's String() writes it for the values people measure: 128, 38.4. */
fun jsNumber(n: Double): String =
    if (n == Math.floor(n) && !n.isInfinite() && Math.abs(n) < 1e15) n.toLong().toString() else n.toString()

/** "37.8 °C", "120/80 mmHg", "72" (no unit); "" when the entry has no value. */
fun formatValue(value: Double?, value2: Double?, unit: String): String {
    if (value == null) return ""
    val n = if (value2 == null) jsNumber(value) else "${jsNumber(value)}/${jsNumber(value2)}"
    return if (unit.isNotEmpty()) "$n $unit" else n
}

fun formatValue(e: HealthEntry): String = formatValue(e.value, e.value2, e.unit)

data class HealthFilter(
    /** Person id; "" for everyone. */
    val person: String = "",
    val kind: HealthKind? = null,
    val bodyPart: String = "",
    val tag: String = "",
    /** Inclusive YYYY-MM-DD bounds; "" for open-ended. */
    val from: String = "",
    val to: String = "",
    /** Only entries rated at least this much; null for any (including unrated). */
    val minSeverity: Int? = null,
    /** Case-insensitive substring of title, body, body part, unit or tags. */
    val text: String = "",
) {
    val isFiltering: Boolean get() = this != HealthFilter()

    /** Filters set in the Filters sheet (not the kind chips or the search box); its badge count. */
    val panelCount: Int
        get() = listOf(
            person.isNotEmpty(),
            bodyPart.isNotEmpty(),
            tag.isNotEmpty(),
            from.isNotEmpty() || to.isNotEmpty(),
            minSeverity != null,
        ).count { it }
}

fun filterHealthLog(entries: List<HealthEntry>, f: HealthFilter): List<HealthEntry> {
    val q = f.text.trim().lowercase()
    return entries.filter { e ->
        (f.person.isEmpty() || e.personId == f.person) &&
            (f.kind == null || e.kind == f.kind) &&
            (f.bodyPart.isEmpty() || e.bodyPart == f.bodyPart) &&
            (f.tag.isEmpty() || f.tag in e.tags) &&
            (f.from.isEmpty() || e.date >= f.from) &&
            (f.to.isEmpty() || e.date <= f.to) &&
            (f.minSeverity == null || (e.severity != null && e.severity >= f.minSeverity)) &&
            (q.isEmpty() || (listOf(e.title, e.body, e.bodyPart, e.unit) + e.tags).any { it.lowercase().contains(q) })
    }
}

enum class SortKey { DATE, PERSON, KIND, TITLE, VALUE, BODY_PART, SEVERITY }

enum class SortDir { ASC, DESC }

/** Direction a key starts in when first chosen: newest, highest and worst first. */
val SortKey.defaultDir: SortDir
    get() = when (this) {
        SortKey.DATE, SortKey.VALUE, SortKey.SEVERITY -> SortDir.DESC
        else -> SortDir.ASC
    }

/**
 * Stable sort. Ties fall back to newest first. Empty values (no measurement, unrated, no body
 * part) always sink to the bottom whatever the direction. `personName` resolves ids for PERSON.
 */
fun sortHealthLog(
    entries: List<HealthEntry>,
    key: SortKey,
    dir: SortDir,
    personName: (String) -> String = { it },
): List<HealthEntry> {
    val sign = if (dir == SortDir.ASC) 1 else -1
    val collator = Collator.getInstance()
    // Same day: by time of day (an entry without a time counts as the start of the day), then by
    // when it was typed in.
    val byDate = Comparator<HealthEntry> { a, b ->
        whenOf(b).compareTo(whenOf(a)).takeIf { it != 0 } ?: b.createdAt.compareTo(a.createdAt)
    }
    fun text(a: String, b: String) = when {
        a == b -> 0
        a.isEmpty() -> 1
        b.isEmpty() -> -1
        else -> sign * collator.compare(a, b)
    }
    fun <T : Comparable<T>> num(a: T?, b: T?) = when {
        a == b -> 0
        a == null -> 1
        b == null -> -1
        else -> sign * a.compareTo(b)
    }
    val cmp = Comparator<HealthEntry> { a, b ->
        when (key) {
            SortKey.DATE -> sign * whenOf(a).compareTo(whenOf(b))
            SortKey.PERSON -> text(personName(a.personId), personName(b.personId))
            SortKey.KIND -> sign * collator.compare(a.kind.label, b.kind.label)
            SortKey.TITLE -> text(a.title.lowercase(), b.title.lowercase())
            SortKey.VALUE -> num(a.value, b.value)
            SortKey.BODY_PART -> text(a.bodyPart, b.bodyPart)
            SortKey.SEVERITY -> num(a.severity, b.severity)
        }
    }
    return entries.sortedWith(cmp.then(byDate))
}

/** Distinct body parts and tags present in the log, sorted, for the filter pickers. */
data class Facets(val bodyParts: List<String>, val tags: List<String>)

fun facets(entries: List<HealthEntry>): Facets = Facets(
    bodyParts = entries.map { it.bodyPart }.filter { it.isNotEmpty() }.distinct().sorted(),
    tags = entries.flatMap { it.tags }.distinct().sorted(),
)

/** Runs of consecutive entries sharing a date, in the order given: the card view's day headers. */
fun groupByDate(entries: List<HealthEntry>): List<Pair<String, List<HealthEntry>>> {
    val out = mutableListOf<Pair<String, MutableList<HealthEntry>>>()
    for (e in entries) {
        val last = out.lastOrNull()
        if (last?.first == e.date) last.second.add(e) else out.add(e.date to mutableListOf(e))
    }
    return out
}
