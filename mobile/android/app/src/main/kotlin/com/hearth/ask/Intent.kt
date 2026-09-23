package com.hearth.ask

import com.hearth.health.BODY_PARTS
import com.hearth.kb.Kb

/**
 * What kind of question this is, from its words alone (intent.ts): rules, not a model, and every
 * type says which words triggered it, so the recommendation can explain itself.
 */
enum class QuestionType(val id: String, val template: String) {
    MEDICATION("medication", "medication"),
    LABS("labs", "labs"),
    SYMPTOMS("symptoms", "symptoms"),
    FAMILY("family", "compare"),
    DOCTOR("doctor", "doctor"),
    REPORT("report", "second-opinion"),
    GENETICS("genetics", "explain"),
}

data class Intent(val type: QuestionType, val signals: List<String>)

/**
 * A question word matches a stem of five or more letters it starts with ("prescribed" ← "prescri"),
 * or a shorter entry exactly ("mom" must not match "moment"). Entries with a space are phrases.
 */
private val SIGNALS: Map<QuestionType, List<String>> = mapOf(
    QuestionType.MEDICATION to listOf(
        "medicat", "medicine", "drug", "drugs", "dose", "doses", "dosage", "pill", "pills", "tablet", "prescri", "side effect",
        "interaction", "statin", "antidepressant", "painkiller", "antibiotic", "supplement", "metaboli", "taking", "mg",
    ),
    QuestionType.LABS to listOf(
        "lab", "labs", "blood test", "test result", "result", "cholesterol", "ldl", "hdl", "triglycerid", "glucose", "hba1c",
        "ferritin", "vitamin", "iron", "tsh", "crp", "creatinin", "reference range", "level", "panel", "trend",
    ),
    QuestionType.SYMPTOMS to listOf(
        "symptom", "pain", "painful", "ache", "aches", "aching", "hurt", "hurts", "fever", "headache", "migraine", "tired",
        "fatigue", "rash", "cough", "dizzy", "dizziness", "nause", "swell", "itch", "itchy", "sleep", "insomnia", "feel",
        "feeling", "sore", "stiff", "temperature", "blood pressure", "weight",
    ),
    QuestionType.FAMILY to listOf(
        "inherit", "heredit", "parent", "mother", "father", "mom", "dad", "child", "son", "sons", "daughter", "sibling",
        "brother", "sister", "family", "carrier", "pass on", "passed on", "compare", "both of", "kids",
    ),
    QuestionType.DOCTOR to listOf(
        "doctor", "appointment", "visit", "clinician", "physician", "specialist", "gp", "cardiologist", "rheumatologist",
        "what to ask", "questions to ask", "prepare",
    ),
    QuestionType.REPORT to listOf(
        "report", "second opinion", "letter", "diagnos", "conclusion", "discharge", "scan", "scans", "mri", "x-ray", "ultrasound",
    ),
    QuestionType.GENETICS to listOf(
        "gene", "genes", "genetic", "variant", "snp", "snps", "genotype", "dna", "mutation", "allele", "risk", "risks", "predispos",
    ),
)

/** Ties go to the more specific type. */
private val ORDER = listOf(
    QuestionType.MEDICATION, QuestionType.LABS, QuestionType.SYMPTOMS, QuestionType.REPORT, QuestionType.DOCTOR,
    QuestionType.FAMILY, QuestionType.GENETICS,
)

private val NON_WORD = Regex("[^\\p{L}\\p{N}*-]+")
private val RSID = Regex("^rs\\d+$")

private fun words(text: String): List<String> = text.lowercase().split(NON_WORD).filter { it.isNotEmpty() }

private fun hits(question: String, stems: List<String>): List<String> {
    val q = question.lowercase()
    val ws = words(question)
    val out = mutableListOf<String>()
    for (stem in stems) {
        val found = if (' ' in stem) stem.takeIf { q.contains(it) } else ws.firstOrNull { it == stem || (stem.length >= 5 && it.startsWith(stem)) }
        if (found != null && found !in out) out.add(found)
    }
    return out
}

/**
 * Every type the question shows signals for, strongest first. Knowledge-base names count too: a
 * kb drug is a medication signal, a gene symbol or rsid a genetics one, a body part a symptom one.
 * Asking about two or more selected people adds a family signal.
 */
fun classifyQuestion(question: String, kb: Kb, peopleSelected: Int = 1): List<Intent> {
    val ws = words(question).toSet()
    val extra = QuestionType.entries.associateWith { mutableListOf<String>() }
    for (e in kb.entries) {
        for (d in e.drugs) if (d.lowercase() in ws) extra.getValue(QuestionType.MEDICATION).add(d.lowercase())
        if (e.gene.lowercase() in ws) extra.getValue(QuestionType.GENETICS).add(e.gene)
        if (e.rsid in ws) extra.getValue(QuestionType.GENETICS).add(e.rsid)
    }
    for (w in ws) if (RSID.matches(w) && w !in extra.getValue(QuestionType.GENETICS)) extra.getValue(QuestionType.GENETICS).add(w)
    for (b in BODY_PARTS) if (question.lowercase().contains(b)) extra.getValue(QuestionType.SYMPTOMS).add(b)
    if (peopleSelected >= 2) extra.getValue(QuestionType.FAMILY).add("several people")
    return ORDER.map { Intent(it, (hits(question, SIGNALS.getValue(it)) + extra.getValue(it)).distinct()) }
        .filter { it.signals.isNotEmpty() }
        .sortedWith(compareByDescending<Intent> { it.signals.size }.thenBy { ORDER.indexOf(it.type) })
}
