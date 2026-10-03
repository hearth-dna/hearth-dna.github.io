package com.hearth.ask

import com.hearth.data.Call
import com.hearth.data.HealthEntry
import com.hearth.data.Person
import com.hearth.health.describeEntry
import com.hearth.kb.Finding

/** Everything the Ask screen has loaded, per person id (items.ts). */
data class AskData(
    val findingsBy: Map<String, List<Finding>>,
    val healthBy: Map<String, List<HealthEntry>>,
    /** Genotypes looked up by rsid that the knowledge base does not describe. */
    val rawBy: Map<String, Map<String, Call>>,
)

/** The record behind a key: exactly one of the three is set. */
data class Resolved(val key: String, val personId: String, val finding: Finding? = null, val call: Call? = null, val health: HealthEntry? = null)

/** The record behind a key, or null while it is not loaded (or no longer exists). */
fun resolve(key: String, d: AskData): Resolved? {
    val k = parseKey(key) ?: return null
    return when (k.kind) {
        'f' -> d.findingsBy[k.personId]?.firstOrNull { it.entry.rsid == k.id }?.let { Resolved(key, k.personId, finding = it) }
        'g' -> d.rawBy[k.personId]?.get(k.id)?.let { Resolved(key, k.personId, call = it) }
        else -> d.healthBy[k.personId]?.firstOrNull { it.id == k.id }?.let { Resolved(key, k.personId, health = it) }
    }
}

/** One line for lists on the screen (the pack has its own formats). */
fun itemLabel(r: Resolved, undescribed: String): String = when {
    r.finding != null -> r.finding.let { f -> "${f.entry.gene} ${f.entry.rsid} ${f.call.a1}/${f.call.a2} — ${f.match?.label ?: undescribed}" }
    r.call != null -> "${r.call.rsid} ${r.call.a1}/${r.call.a2} (chr${r.call.chromosome}:${r.call.position})"
    else -> describeEntry(r.health!!)
}

/**
 * The pack's people: the selected ones with at least one included record, in the order of
 * [persons] (so pseudonym letters are stable), records in the order they were added, health
 * entries newest first as in the log.
 */
fun packPeople(keys: List<String>, d: AskData, persons: List<Person>, selected: List<String>): List<PackPerson> {
    val resolved = keys.mapNotNull { resolve(it, d) }
    return persons.filter { it.id in selected }.mapNotNull { person ->
        val mine = resolved.filter { it.personId == person.id }
        if (mine.isEmpty()) return@mapNotNull null
        PackPerson(
            person,
            findings = mine.mapNotNull { it.finding },
            genotypes = mine.mapNotNull { it.call },
            health = mine.mapNotNull { it.health }.sortedWith(compareByDescending<HealthEntry> { it.date }.thenByDescending { it.time }),
        )
    }
}
