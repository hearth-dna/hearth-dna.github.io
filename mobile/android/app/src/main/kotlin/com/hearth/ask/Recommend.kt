package com.hearth.ask

import com.hearth.data.HealthEntry
import com.hearth.data.HealthKind
import com.hearth.kb.Finding
import com.hearth.kb.Kb
import java.time.Instant
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

/**
 * One record that can go into a context pack (recommend.ts). Keys are stable strings so the page
 * can keep an ordered selection: `f:<person>:<rsid>` a kb finding, `g:<person>:<rsid>` a genotype
 * the kb does not describe, `h:<person>:<entry id>` a health-log entry.
 */
fun findingKey(personId: String, rsid: String) = "f:$personId:$rsid"
fun genotypeKey(personId: String, rsid: String) = "g:$personId:$rsid"
fun healthKey(personId: String, id: String) = "h:$personId:$id"

data class ParsedKey(val kind: Char, val personId: String, val id: String)

private val KEY = Regex("^([fgh]):([^:]+):(.+)$")

fun parseKey(key: String): ParsedKey? = KEY.find(key)?.let { ParsedKey(it.groupValues[1][0], it.groupValues[2], it.groupValues[3]) }

/** Why a record is suggested; the screen turns it into a sentence. */
sealed interface Reason {
    data class Mentioned(val term: String) : Reason
    data object Pharmacogenomic : Reason
    data object Notable : Reason
    data object SharedVariant : Reason
    data class MatchesQuestion(val term: String) : Reason
    data class Recent(val kind: HealthKind) : Reason
}

data class Suggestion(val key: String, val personId: String, val reason: Reason)

/** One person's records: kb findings, and health entries newest first as the repository returns them. */
data class PersonRecords(val personId: String, val findings: List<Finding>, val health: List<HealthEntry>)

private fun Finding.magnitude() = match?.magnitude ?: 0.0

/**
 * Up to [n] newest entries of a kind, preferring those within [days] of [now]; when none is that
 * recent the newest ones still count (a lab panel from last year beats no lab panel).
 */
private fun newest(entries: List<HealthEntry>, kind: HealthKind, n: Int, days: Long, now: Instant): List<HealthEntry> {
    val of = entries.filter { it.kind == kind }
    val cutoff = now.minus(days, ChronoUnit.DAYS).atZone(ZoneOffset.UTC).toLocalDate().toString()
    val recent = of.filter { it.date >= cutoff }
    return (recent.ifEmpty { of }).take(n)
}

/** What each question type pulls from the health log: kind, how many, how far back in days. */
private val HEALTH_PLAN: Map<QuestionType, List<Triple<HealthKind, Int, Long>>> = mapOf(
    QuestionType.MEDICATION to listOf(Triple(HealthKind.MEDICATION, 10, 365), Triple(HealthKind.DIAGNOSIS, 5, 3650)),
    QuestionType.LABS to listOf(Triple(HealthKind.LAB, 10, 730), Triple(HealthKind.MEDICATION, 5, 365)),
    QuestionType.SYMPTOMS to listOf(
        Triple(HealthKind.SYMPTOM, 10, 90), Triple(HealthKind.MEASUREMENT, 15, 30),
        Triple(HealthKind.MEDICATION, 5, 90), Triple(HealthKind.DIAGNOSIS, 3, 3650),
    ),
    QuestionType.FAMILY to listOf(Triple(HealthKind.DIAGNOSIS, 5, 3650)),
    QuestionType.DOCTOR to listOf(
        Triple(HealthKind.SYMPTOM, 8, 60), Triple(HealthKind.DIAGNOSIS, 5, 3650),
        Triple(HealthKind.MEDICATION, 8, 365), Triple(HealthKind.LAB, 5, 365),
    ),
    QuestionType.REPORT to listOf(Triple(HealthKind.LETTER, 3, 365), Triple(HealthKind.IMAGING, 3, 365), Triple(HealthKind.DIAGNOSIS, 3, 3650)),
    QuestionType.GENETICS to emptyList(),
)

/**
 * Records worth including for this question, per person, most relevant first and without
 * duplicates: kb entries named in the question, health entries whose words match it, then what the
 * question types call for (pharmacogenomic markers for medication, recent labs for lab questions,
 * variants several people share for family questions…).
 */
fun recommend(kb: Kb, question: String, intents: List<Intent>, people: List<PersonRecords>, now: Instant = Instant.now()): List<Suggestion> {
    val out = mutableListOf<Suggestion>()
    val seen = HashSet<String>()
    fun add(key: String, personId: String, reason: Reason) {
        if (seen.add(key)) out.add(Suggestion(key, personId, reason))
    }
    val types = intents.map { it.type }.toCollection(LinkedHashSet())
    val mentioned = retrieveForQuestion(kb, question)
    // Health text is prose: only words of four letters or more are specific enough to match on.
    val terms = questionTerms(question).filter { it.length >= 4 }
    val patterns = terms.map { it to Regex("\\b" + Regex.escape(it)) }
    // Variants at least two selected people carry with some impact.
    val carriers = HashMap<String, Int>()
    for (p in people) for (f in p.findings) if (f.magnitude() > 0) carriers.merge(f.entry.rsid, 1, Int::plus)

    for (p in people) {
        for (f in p.findings) if (f.entry.rsid in mentioned) add(findingKey(p.personId, f.entry.rsid), p.personId, Reason.Mentioned(f.entry.gene))
        for (e in p.health) {
            val text = (listOf(e.title, e.bodyPart) + e.tags + e.body).joinToString(" ").lowercase()
            patterns.firstOrNull { it.second.containsMatchIn(text) }?.let { add(healthKey(p.personId, e.id), p.personId, Reason.MatchesQuestion(it.first)) }
        }
        if (QuestionType.MEDICATION in types)
            for (f in p.findings) if (f.entry.topic == "pharmacogenomics" && f.magnitude() > 0) add(findingKey(p.personId, f.entry.rsid), p.personId, Reason.Pharmacogenomic)
        if (QuestionType.FAMILY in types)
            for (f in p.findings) if ((carriers[f.entry.rsid] ?: 0) >= 2) add(findingKey(p.personId, f.entry.rsid), p.personId, Reason.SharedVariant)
        for (type in types) for ((kind, n, days) in HEALTH_PLAN.getValue(type))
            for (e in newest(p.health, kind, n, days, now)) add(healthKey(p.personId, e.id), p.personId, Reason.Recent(kind))
        // Notable markers when nothing more specific came from the kb.
        if ((QuestionType.GENETICS in types || QuestionType.DOCTOR in types || QuestionType.LABS in types) && mentioned.isEmpty())
            for (f in p.findings) if (f.magnitude() >= 2) add(findingKey(p.personId, f.entry.rsid), p.personId, Reason.Notable)
    }
    return out
}
