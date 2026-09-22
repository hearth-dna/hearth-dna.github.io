package com.hearth.data

/** Kotlin shapes of the web's `types.ts` records the native screens use so far. */

data class Person(
    val id: String,
    val label: String,
    val displayName: String,
    val sex: String,
    val birthYear: Int?,
    val notes: String,
    val createdAt: String,
)

/** The stored value of `health_log.kind`; the order is the web's `HEALTH_KIND_LABELS`. */
enum class HealthKind(val id: String, val label: String) {
    SYMPTOM("symptom", "Symptom"),
    MEASUREMENT("measurement", "Measurement"),
    LAB("lab", "Lab result"),
    IMAGING("imaging", "Imaging report"),
    DIAGNOSIS("diagnosis", "Diagnosis"),
    MEDICATION("medication", "Medication"),
    LETTER("letter", "Doctor letter"),
    OTHER("other", "Other");

    companion object {
        /** An unknown kind from a newer app shows as Other rather than failing the whole list. */
        fun of(id: String): HealthKind = entries.firstOrNull { it.id == id } ?: OTHER
    }
}

data class HealthEntry(
    val id: String,
    val personId: String,
    /** YYYY-MM-DD. */
    val date: String,
    /** HH:MM, or "" when no time was recorded. */
    val time: String,
    val kind: HealthKind,
    val title: String,
    val body: String,
    /** "model:date" when a model transcribed it from a document; "" when typed. */
    val source: String,
    val bodyPart: String,
    val severity: Int?,
    val tags: List<String>,
    val value: Double?,
    val value2: Double?,
    val unit: String,
    val createdAt: String,
)

data class Attachment(
    val id: String,
    val healthLogId: String,
    val personId: String,
    val sha256: String,
    val mime: String,
    val bytes: Long,
    val name: String,
    val createdAt: String,
)
