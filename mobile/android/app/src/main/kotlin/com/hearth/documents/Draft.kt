package com.hearth.documents

import com.hearth.data.HealthKind
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the document reader returns and what the add form is prefilled with (documents/draft.ts).
 * The user reviews and edits it before anything is saved; model output is never stored unseen.
 */
data class HealthDraft(val date: String, val kind: HealthKind, val title: String, val body: String)

/** What the user says the document is; "auto" lets the model decide. */
val DOCUMENT_HINTS = listOf("auto", "lab", "imaging", "letter", "medication", "diagnosis")

/** The instruction sent with the pages. Transcription only: no interpretation, no advice. */
fun documentPrompt(hint: String): String {
    val what = if (hint == "auto") "a medical document" else "a ${HealthKind.of(hint).label.lowercase()}"
    return listOf(
        "The attached pages are $what belonging to the user. Transcribe it faithfully into the JSON schema.",
        "date: the document date in YYYY-MM-DD, or \"\" if not printed. kind: one of lab, imaging, letter, medication, diagnosis, other.",
        "title: a short label (test panel, modality and body region, or letter subject).",
        "body: the findings and conclusion in the document's own words, translated to English if needed, preserving the original wording of the conclusion. Do not add interpretation, risk statements or advice.",
        "values: every measured value as {name, value, unit, ref} for lab sheets; empty otherwise. Keep names as printed.",
        "Leave out patient name, date of birth, address, insurance and record numbers.",
    ).joinToString(" ")
}

/** Gemini `responseSchema` (an OpenAPI subset), the same object the web sends. */
fun documentSchema(): JSONObject {
    fun str() = JSONObject().put("type", "string")
    val value = JSONObject().put("type", "object")
        .put("properties", JSONObject().put("name", str()).put("value", str()).put("unit", str()).put("ref", str()))
        .put("required", JSONArray().put("name").put("value"))
    return JSONObject().put("type", "object")
        .put(
            "properties",
            JSONObject()
                .put("date", str())
                .put("kind", str().put("enum", JSONArray(listOf("lab", "imaging", "letter", "medication", "diagnosis", "other"))))
                .put("title", str())
                .put("body", str())
                .put("values", JSONObject().put("type", "array").put("items", value)),
        )
        .put("required", JSONArray(listOf("date", "kind", "title", "body", "values")))
}

private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

/** The model's JSON as a draft: tolerant of missing fields, strict about the kind and the date. */
fun draftFromJson(text: String, fallbackDate: String): HealthDraft {
    val j = JSONObject(text)
    val values = j.optJSONArray("values") ?: JSONArray()
    val lines = (0 until values.length()).mapNotNull { i ->
        val v = values.optJSONObject(i) ?: return@mapNotNull null
        val name = v.optString("name")
        if (name.isEmpty() || !v.has("value")) return@mapNotNull null
        val unit = v.optString("unit")
        val ref = v.optString("ref")
        "$name: ${v.optString("value")}${if (unit.isNotEmpty()) " $unit" else ""}${if (ref.isNotEmpty()) " (ref $ref)" else ""}"
    }
    val body = listOf(j.optString("body").trim(), lines.joinToString("\n")).filter { it.isNotEmpty() }.joinToString("\n\n")
    val date = j.optString("date")
    val kind = j.optString("kind")
    return HealthDraft(
        date = if (DATE.matches(date)) date else fallbackDate,
        kind = HealthKind.entries.firstOrNull { it.id == kind } ?: HealthKind.OTHER,
        title = j.optString("title").trim().ifEmpty { "Untitled document" },
        body = body,
    )
}
