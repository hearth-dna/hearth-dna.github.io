package com.hearth.ask

import com.hearth.data.Call
import com.hearth.data.HealthEntry
import com.hearth.data.HealthKind
import com.hearth.data.Person
import com.hearth.health.describeEntry
import com.hearth.health.formatTags
import com.hearth.health.formatValue
import com.hearth.health.whenOf
import com.hearth.kb.Finding
import kotlin.math.roundToLong

/**
 * The copy-out context pack (contextPack.ts, docs/design.md §6.3), character for character, so the
 * same selection gives the same text in every app. Pure and deterministic: the preview is exactly
 * what is copied. Pseudonymised by default: labels instead of names, ages rounded to five years.
 * Compact mode puts every record on one line, shortens long text and folds repeated measurements
 * into one series.
 */
data class PackPerson(
    val person: Person,
    val findings: List<Finding>,
    /** Genotypes the knowledge base does not describe (looked up by rsid). */
    val genotypes: List<Call> = emptyList(),
    /** Health-log entries chosen, newest first. */
    val health: List<HealthEntry> = emptyList(),
)

data class PackOptions(
    val question: String,
    val people: List<PackPerson>,
    val realNames: Boolean,
    /** The calendar year ages are computed in (the web's `now.getFullYear()`). */
    val year: Int,
    val template: PromptTemplate? = null,
    val compact: Boolean = false,
    val evidence: Boolean = true,
    val appName: String = "Hearth",
)

/** Math.round: halves go up, as in JavaScript. */
private fun jsRound(x: Double): Long = Math.floor(x + 0.5).roundToLong()

fun labelFor(p: Person, i: Int, realNames: Boolean, year: Int): String {
    val parts = mutableListOf(if (realNames) p.displayName else "Person ${'A' + i}")
    if (p.sex != "unknown") parts.add(p.sex)
    p.birthYear?.takeIf { it != 0 }?.let {
        val age = year - it
        parts.add(if (realNames) "$age" else "about ${jsRound(age / 5.0) * 5}")
    }
    return parts.joinToString(", ")
}

fun buildContextPack(o: PackOptions): String {
    val lines = mutableListOf<String>()
    lines.add("# Context for a health question (generated locally by ${o.appName}; informational, not medical advice)")
    lines.add("")
    o.people.forEachIndexed { i, pp ->
        lines.add("## ${labelFor(pp.person, i, o.realNames, o.year)}")
        if (o.compact) compactPerson(pp, lines) else fullPerson(pp, lines)
        lines.add("")
    }
    val seen = HashSet<String>()
    val evidence = mutableListOf<String>()
    if (o.evidence) for (pp in o.people) for (f in pp.findings) {
        if (!seen.add(f.entry.rsid)) continue
        val sources = if (o.compact) f.entry.sources.take(1) else f.entry.sources
        evidence.add("- ${f.entry.name}: ${f.entry.summary} Sources: ${sources.joinToString(", ")}")
    }
    if (evidence.isNotEmpty()) {
        lines.add("## Evidence notes (from the local knowledge base)")
        lines.addAll(evidence)
        lines.add("")
    }
    lines.add("## Question")
    lines.add(o.question.trim().ifEmpty { "(no question entered)" })
    lines.add("")
    lines.add("## Instructions for the assistant")
    o.template?.let { lines.add(it.text) }
    lines.add(ASSISTANT_INSTRUCTIONS)
    return lines.joinToString("\n")
}

private fun fullPerson(pp: PackPerson, lines: MutableList<String>) {
    if (pp.findings.isEmpty() && pp.genotypes.isEmpty()) lines.add("- (no relevant genotypes selected)")
    for (f in pp.findings) {
        val e = f.entry
        val status = f.match?.label ?: "genotype not described in knowledge base"
        lines.add("- ${e.gene} ${e.rsid} (${e.name}): ${f.call.a1}/${f.call.a2} — $status [evidence ${e.evidence}]")
    }
    for (c in pp.genotypes) lines.add("- ${c.rsid} (chr${c.chromosome}:${c.position}): ${c.a1}/${c.a2} — not in the knowledge base")
    if (pp.health.isNotEmpty()) {
        lines.add("### Health log (the person's documents and self-reported symptoms, dated)")
        for (h in pp.health) {
            val body = h.body.trim().replace("\n", "\n  ")
            lines.add("- ${describeEntry(h)}${if (body.isNotEmpty()) "\n  $body" else ""}")
        }
    }
}

/** Longest free text kept per health entry in compact mode. */
const val COMPACT_TEXT = 240

private val SENTENCE_END = Regex("[.;:!?]$")
private val SPACES = Regex("\\s+")

/** Whitespace and line breaks collapsed, cut at [max] characters with an ellipsis. */
fun squeeze(text: String, max: Int = COMPACT_TEXT): String {
    val flat = text.split(Regex("\n+")).map { it.trim() }.filter { it.isNotEmpty() }
        .fold("") { acc, l -> if (acc.isEmpty()) l else acc + (if (SENTENCE_END.containsMatchIn(acc)) " " else "; ") + l }
        .replace(SPACES, " ")
    return if (flat.length > max) flat.substring(0, max - 1).trimEnd() + "…" else flat
}

private fun compactPerson(pp: PackPerson, lines: MutableList<String>) {
    if (pp.findings.isNotEmpty() || pp.genotypes.isNotEmpty()) {
        lines.add("Genotypes:")
        for (f in pp.findings) {
            val e = f.entry
            val status = f.match?.label ?: "not described in knowledge base"
            lines.add("- ${e.gene} ${e.rsid} ${f.call.a1}/${f.call.a2}: $status [evidence ${e.evidence}]")
        }
        for (c in pp.genotypes) lines.add("- ${c.rsid} ${c.a1}/${c.a2} (chr${c.chromosome}:${c.position}; not in knowledge base)")
    }
    if (pp.health.isEmpty()) return
    lines.add("Health log:")
    // Measurements of the same thing in the same unit become one series line, oldest first,
    // placed where the newest of them would have been.
    fun seriesKey(h: HealthEntry) = "${h.title.trim().lowercase()}\u0000${h.unit}"
    fun isSeries(h: HealthEntry) = h.kind == HealthKind.MEASUREMENT && h.value != null
    val series = LinkedHashMap<String, MutableList<HealthEntry>>()
    for (h in pp.health) if (isSeries(h)) series.getOrPut(seriesKey(h)) { mutableListOf() }.add(h)
    val done = HashSet<String>()
    for (h in pp.health) {
        val group = if (isSeries(h)) series[seriesKey(h)] else null
        if (group != null && group.size > 1) {
            if (!done.add(seriesKey(h))) continue
            val points = group.reversed().joinToString("; ") { m ->
                val note = squeeze(m.body, 60)
                "${whenOf(m)} ${formatValue(m.value, m.value2, "")}${if (note.isNotEmpty()) " ($note)" else ""}"
            }
            lines.add("- ${h.title}${if (h.unit.isNotEmpty()) ", ${h.unit}" else ""} (${group.size} readings): $points")
            continue
        }
        val value = formatValue(h)
        val extra = listOf(h.bodyPart, h.severity?.let { "severity $it/10" } ?: "", formatTags(h.tags)).filter { it.isNotEmpty() }
        val body = squeeze(h.body)
        lines.add(
            "- ${whenOf(h)} ${h.kind.id}: ${h.title}${if (value.isNotEmpty()) " $value" else ""}" +
                (if (extra.isNotEmpty()) " (${extra.joinToString("; ")})" else "") + (if (body.isNotEmpty()) " — $body" else ""),
        )
    }
}

data class PackStats(val chars: Int, val tokens: Int, val genotypes: Int, val healthEntries: Int)

/** Counts for the preview, the confirmation and the sharing log. */
fun packStats(people: List<PackPerson>, pack: String) = PackStats(
    chars = pack.length,
    // Rough: English-like text runs about four characters per token in common tokenisers.
    tokens = (pack.length + 3) / 4,
    genotypes = people.sumOf { it.findings.size + it.genotypes.size },
    healthEntries = people.sumOf { it.health.size },
)
