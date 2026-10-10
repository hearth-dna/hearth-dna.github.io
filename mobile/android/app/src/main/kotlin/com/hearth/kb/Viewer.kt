package com.hearth.kb

import com.hearth.ask.PackPerson
import com.hearth.data.Person
import java.text.Collator

/**
 * The DNA tab's model: a port of frontend/src/kb/viewer.ts. Every marker the knowledge base
 * describes, most clinically useful first, filtered by area of medicine, text and notability, with
 * each selected person's genotype beside it. Pure.
 */

/** Impact at or above which a genotype counts as notable (the Ask screen uses the same bar). */
const val NOTABLE = 2.0

private fun KbEntry.maxMagnitude() = genotypes.values.maxOfOrNull { it.magnitude }?.coerceAtLeast(0.0) ?: 0.0

/**
 * Clinical value, best first: evidence grade (A before C), then medical topics before lifestyle
 * ones, then the largest impact any genotype of the marker can have, then gene.
 */
fun rankEntries(kb: Kb): List<KbEntry> {
    val clinical = kb.topics.filter { it.category == "clinical" }.map { it.id }.toSet()
    val collator = Collator.getInstance()
    return kb.entries.sortedWith { a, b ->
        collator.compare(a.evidence, b.evidence).takeIf { it != 0 }
            ?: (if (b.topic in clinical) 1 else 0).compareTo(if (a.topic in clinical) 1 else 0).takeIf { it != 0 }
            ?: b.maxMagnitude().compareTo(a.maxMagnitude()).takeIf { it != 0 }
            ?: collator.compare(a.gene, b.gene).takeIf { it != 0 }
            ?: collator.compare(a.rsid, b.rsid)
    }
}

data class ViewerFilter(
    /** Area ids; a marker in any of them is shown. Empty: every area. */
    val areas: List<String> = emptyList(),
    val query: String = "",
    /** Only markers where a shown person has a notable genotype. */
    val notable: Boolean = false,
)

data class ViewerRow(
    val entry: KbEntry,
    /** Per shown person id; absent when the person was not genotyped for this marker. */
    val findings: Map<String, Finding>,
)

fun viewerRows(kb: Kb, findingsBy: Map<String, List<Finding>>, personIds: List<String>, f: ViewerFilter): List<ViewerRow> {
    val hits = if (f.query.isBlank()) null else searchKb(kb, f.query).toSet()
    return rankEntries(kb)
        .filter { f.areas.isEmpty() || it.areas.any { a -> a in f.areas } }
        .filter { hits == null || it in hits }
        .map { entry ->
            val found = personIds.mapNotNull { id -> findingsBy[id]?.firstOrNull { it.entry.rsid == entry.rsid }?.let { id to it } }
            ViewerRow(entry, found.toMap())
        }
        .filter { r -> !f.notable || r.findings.values.any { (it.match?.magnitude ?: 0.0) >= NOTABLE } }
}

/** The rows as context-pack people: each shown person with their genotypes for these markers. */
fun viewerPackPeople(rows: List<ViewerRow>, people: List<Person>): List<PackPerson> =
    people.map { p -> PackPerson(p, rows.mapNotNull { it.findings[p.id] }) }.filter { it.findings.isNotEmpty() }

/** The question the pack asks when the user leaves it empty, in English like the rest of the pack. */
fun viewerQuestion(kb: Kb, areas: List<String>): String {
    val names = kb.areas.filter { it.id in areas }.map { it.name().lowercase() }
    return if (names.isNotEmpty()) "What do these genotypes mean for ${names.joinToString(", ")}? What, if anything, is worth acting on or checking?"
    else "What do these genotypes mean, and what, if anything, is worth acting on or checking?"
}
