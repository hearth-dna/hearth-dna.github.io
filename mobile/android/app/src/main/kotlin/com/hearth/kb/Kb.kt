package com.hearth.kb

import com.hearth.data.Call
import org.json.JSONObject
import java.text.Collator

/**
 * The bundled knowledge base (frontend/public/kb.json, built by kb/build_kb.py) and the logic over
 * it: a port of frontend/src/kb/kb.ts and sortFindings.ts. The file ships inside the app, copied in
 * by `make mobile-assets`; nothing is fetched.
 */
data class KbGenotype(val label: String, val magnitude: Double)

data class KbEntry(
    val rsid: String,
    val gene: String,
    val name: String,
    val riskAllele: String,
    val evidence: String,
    val summary: String,
    val genotypes: Map<String, KbGenotype>,
    val sources: List<String>,
    val drugs: List<String>,
    val conditions: List<String>,
    val topic: String,
    val generatedBy: String,
)

data class Kb(val version: String, val entries: List<KbEntry>) {
    companion object {
        fun parse(json: String): Kb {
            val o = JSONObject(json)
            val a = o.getJSONArray("entries")
            fun strings(e: JSONObject, key: String) = e.optJSONArray(key)?.let { l -> (0 until l.length()).map { l.getString(it) } } ?: emptyList()
            val entries = (0 until a.length()).map { i ->
                val e = a.getJSONObject(i)
                val g = e.getJSONObject("genotypes")
                KbEntry(
                    rsid = e.getString("rsid"),
                    gene = e.getString("gene"),
                    name = e.optString("name"),
                    riskAllele = e.optString("risk_allele"),
                    evidence = e.optString("evidence"),
                    summary = e.optString("summary"),
                    genotypes = g.keys().asSequence().associateWith { k ->
                        g.getJSONObject(k).let { KbGenotype(it.optString("label"), it.optDouble("magnitude", 0.0)) }
                    },
                    sources = strings(e, "sources"),
                    drugs = strings(e, "drugs"),
                    conditions = strings(e, "conditions"),
                    topic = e.optString("topic"),
                    generatedBy = e.optString("generated_by"),
                )
            }
            return Kb(o.optString("version"), entries)
        }
    }
}

fun normGenotype(a1: String, a2: String): String = listOf(a1, a2).sorted().joinToString("")

data class Finding(val entry: KbEntry, val genotype: String, val call: Call, val match: KbGenotype?, val riskCopies: Int)

/** "12.0" → "12", "2.5" → "2.5": magnitudes shown the way JavaScript prints numbers. */
fun Double.plain(): String = if (this == Math.floor(this) && !isInfinite()) toLong().toString() else toString()

/** Joins a person's calls against the kb. A genotype the kb does not describe still gives a finding, with no match. */
fun computeFindings(kb: Kb, calls: Iterable<Call>): List<Finding> {
    val byRsid = kb.entries.associateBy { it.rsid }
    val out = mutableListOf<Finding>()
    for (c in calls) {
        val entry = byRsid[c.rsid] ?: continue
        if (c.a1 == "-") continue
        val genotype = normGenotype(c.a1, if (c.a2 == "-") c.a1 else c.a2)
        val riskCopies = (if (c.a1 == entry.riskAllele) 1 else 0) + (if (c.a2 == entry.riskAllele) 1 else 0)
        out.add(Finding(entry, genotype, c, entry.genotypes[genotype], riskCopies))
    }
    val collator = Collator.getInstance()
    return out.sortedWith { a, b ->
        (b.match?.magnitude ?: 0.0).compareTo(a.match?.magnitude ?: 0.0).takeIf { it != 0 }
            ?: collator.compare(a.entry.evidence, b.entry.evidence)
    }
}

/** Text search over the kb: rsid, gene, name, summary, drugs, conditions. */
fun searchKb(kb: Kb, q: String): List<KbEntry> {
    val needle = q.trim().lowercase()
    if (needle.isEmpty()) return emptyList()
    return kb.entries.filter { e ->
        (listOf(e.rsid, e.gene, e.name, e.summary) + e.drugs + e.conditions).any { it.lowercase().contains(needle) }
    }
}

enum class FindingSortKey(val defaultAscending: Boolean) {
    GENE(true), RISK_COPIES(false), TOPIC(true), EVIDENCE(true), MAGNITUDE(false)
}

private fun Finding.magnitude() = match?.magnitude ?: -1.0

/** Stable sort by [key]; ties fall back to impact (desc) then gene, so the order is deterministic. */
fun sortFindings(findings: List<Finding>, key: FindingSortKey, ascending: Boolean): List<Finding> {
    val collator = Collator.getInstance()
    val gene = Comparator<Finding> { a, b -> collator.compare(a.entry.gene, b.entry.gene).takeIf { it != 0 } ?: collator.compare(a.entry.rsid, b.entry.rsid) }
    val by: Comparator<Finding> = when (key) {
        FindingSortKey.GENE -> gene
        FindingSortKey.TOPIC -> Comparator { a, b -> collator.compare(a.entry.topic, b.entry.topic) }
        FindingSortKey.EVIDENCE -> Comparator { a, b -> collator.compare(a.entry.evidence, b.entry.evidence) }
        FindingSortKey.RISK_COPIES -> compareBy { it.riskCopies }
        FindingSortKey.MAGNITUDE -> compareBy { it.magnitude() }
    }
    val directed = if (ascending) by else by.reversed()
    return findings.sortedWith(directed.thenComparator { a, b -> b.magnitude().compareTo(a.magnitude()) }.then(gene))
}
