package com.hearth.ask

import com.hearth.kb.Kb
import com.hearth.kb.KbEntry

/**
 * Which knowledge-base entries a free-text question is about (retrieve.ts). Matches gene symbols,
 * marker names, rsids, drugs and conditions only, never summary prose, and ignores a stop list so
 * "with", "about", "should" cannot pull in unrelated markers.
 */
private val STOP = (
    "the for you did has had was not his her him she who why its our out get got see use used now new too off own about above after again against all also and any are around because been before being below between both but can could does doing down during each even ever every from further have having here how into just like more most much need only other over same should since some such than that their them then there these they this those through under until very were what when where which while will with within without would your yours does dont should worry given compare status risk gene genes variant variants family member members mother father parent parents child children"
    ).split(" ").toSet()

private val NON_TERM = Regex("[^a-z0-9*]+")

fun questionTerms(question: String): List<String> =
    question.lowercase().split(NON_TERM).filter { it.length >= 3 && it !in STOP }.distinct()

private fun entryTerms(e: KbEntry): List<String> =
    (listOf(e.rsid, e.gene, e.name) + e.drugs + e.conditions).flatMap { it.lowercase().split(NON_TERM) }.filter { it.length >= 3 }

fun retrieveForQuestion(kb: Kb, question: String): Set<String> {
    val terms = questionTerms(question)
    val hits = LinkedHashSet<String>()
    if (terms.isEmpty()) return hits
    for (e in kb.entries) {
        val et = entryTerms(e)
        // Whole-token match, or a term that is a prefix of a token of 5+ letters (statin → statins).
        if (terms.any { t -> et.any { w -> w == t || (t.length >= 5 && w.startsWith(t)) || (w.length >= 5 && t.startsWith(w)) } }) hits.add(e.rsid)
    }
    return hits
}
