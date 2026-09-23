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

/** `Sex` in types.ts, as stored in `person.sex`. */
enum class Sex(val id: String) {
    UNKNOWN("unknown"), MALE("male"), FEMALE("female");

    companion object {
        fun of(id: String): Sex = entries.firstOrNull { it.id == id } ?: UNKNOWN
    }
}

/** The raw-data formats Hearth reads (`Provider` and `PROVIDER_LABELS` in types.ts). */
enum class Provider(val id: String, val label: String) {
    ANCESTRYDNA("ancestrydna", "AncestryDNA"),
    TWENTYTHREEANDME("23andme", "23andMe"),
    MYHERITAGE("myheritage", "MyHeritage"),
    FAMILYTREEDNA("familytreedna", "FamilyTreeDNA"),
    LIVINGDNA("livingdna", "Living DNA"),
    GENOTEK_VCF("genotek-vcf", "Genotek (VCF)"),
    GENERIC("generic", "Generic rsid/chr/pos/genotype text");

    companion object {
        fun of(id: String): Provider = entries.firstOrNull { it.id == id } ?: GENERIC
    }
}

/** One genotype call: alleles on the forward strand, '-' for no call. */
data class Call(val rsid: String, val chromosome: String, val position: Long, val a1: String, val a2: String)

/** A call with the person it belongs to (the web's `FamilyCall`). */
data class FamilyCall(val personId: String, val call: Call)

data class SourceFile(
    val id: String,
    val personId: String,
    val provider: Provider,
    val build: String,
    val sha256: String,
    val originalName: String,
    val rowCount: Int,
    val importedAt: String,
)

data class Relationship(val parentId: String, val childId: String)

/** `mendelianSql`'s result: how many autosomal calls were compared and how many broke the rules. */
data class Mendelian(val compared: Int, val violations: Int) {
    val rate: Double get() = if (compared == 0) 0.0 else violations.toDouble() / compared
}
