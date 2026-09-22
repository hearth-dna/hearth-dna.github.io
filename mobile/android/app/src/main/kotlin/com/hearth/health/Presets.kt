package com.hearth.health

import com.hearth.data.HealthKind

/**
 * Port of frontend/src/health/presets.ts: common situations offered as one-tap starting points for
 * an entry. A preset only prefills the form. `title` is what is stored (English, like the web);
 * the screen shows the translation under `preset.<id>`. Generated from the web list; keep the ids.
 */
data class HealthPreset(
    val id: String,
    val title: String,
    val kind: HealthKind,
    val bodyPart: String = "",
    val tags: List<String> = emptyList(),
    /** Measurements only. */
    val unit: String = "",
    /** Measurements with two numbers (systolic/diastolic): the i18n suffixes of `preset.pair.*`. */
    val pair: Pair<String, String>? = null,
    val step: Double? = null,
)

val MEASUREMENT_PRESETS = listOf(
    HealthPreset("temperature", "Body temperature", HealthKind.MEASUREMENT, unit = "°C", step = 0.1),
    HealthPreset("blood-pressure", "Blood pressure", HealthKind.MEASUREMENT, bodyPart = "heart", unit = "mmHg", pair = "systolic" to "diastolic", step = 1.0),
    HealthPreset("heart-rate", "Heart rate", HealthKind.MEASUREMENT, bodyPart = "heart", unit = "bpm", step = 1.0),
    HealthPreset("spo2", "Blood oxygen (SpO₂)", HealthKind.MEASUREMENT, bodyPart = "lungs", unit = "%", step = 1.0),
    HealthPreset("weight", "Weight", HealthKind.MEASUREMENT, unit = "kg", step = 0.1),
    HealthPreset("height", "Height", HealthKind.MEASUREMENT, unit = "cm", step = 0.5),
    HealthPreset("glucose", "Blood glucose", HealthKind.MEASUREMENT, unit = "mmol/L", step = 0.1),
    HealthPreset("sleep", "Sleep", HealthKind.MEASUREMENT, unit = "h", step = 0.25),
    HealthPreset("peak-flow", "Peak flow", HealthKind.MEASUREMENT, bodyPart = "lungs", unit = "L/min", step = 5.0),
    HealthPreset("respiratory-rate", "Breathing rate", HealthKind.MEASUREMENT, bodyPart = "lungs", unit = "breaths/min", step = 1.0),
    HealthPreset("waist", "Waist circumference", HealthKind.MEASUREMENT, bodyPart = "abdomen", unit = "cm", step = 0.5),
    HealthPreset("hip", "Hip circumference", HealthKind.MEASUREMENT, bodyPart = "hips", unit = "cm", step = 0.5),
    HealthPreset("body-fat", "Body fat", HealthKind.MEASUREMENT, unit = "%", step = 0.1),
    HealthPreset("muscle-mass", "Muscle mass", HealthKind.MEASUREMENT, unit = "%", step = 0.1),
    HealthPreset("head-circumference", "Head circumference", HealthKind.MEASUREMENT, bodyPart = "head", unit = "cm", step = 0.5),
    HealthPreset("steps", "Steps", HealthKind.MEASUREMENT, unit = "steps", step = 100.0),
    HealthPreset("water", "Water drunk", HealthKind.MEASUREMENT, unit = "L", step = 0.1),
    HealthPreset("mood", "Mood", HealthKind.MEASUREMENT, unit = "/10", step = 1.0),
    HealthPreset("stress", "Stress", HealthKind.MEASUREMENT, unit = "/10", step = 1.0),
    HealthPreset("inr", "INR (blood clotting)", HealthKind.MEASUREMENT, unit = "ratio", step = 0.1),
)

val SYMPTOM_PRESETS = listOf(
    HealthPreset("headache", "Headache", HealthKind.SYMPTOM, bodyPart = "head"),
    HealthPreset("migraine", "Migraine", HealthKind.SYMPTOM, bodyPart = "head", tags = listOf("migraine")),
    HealthPreset("fever", "Fever", HealthKind.SYMPTOM, bodyPart = "whole body"),
    HealthPreset("chills", "Chills", HealthKind.SYMPTOM, bodyPart = "whole body"),
    HealthPreset("fatigue", "Fatigue", HealthKind.SYMPTOM, bodyPart = "whole body"),
    HealthPreset("dizziness", "Dizziness", HealthKind.SYMPTOM, bodyPart = "head"),
    HealthPreset("nosebleed", "Nosebleed", HealthKind.SYMPTOM, bodyPart = "nose"),
    HealthPreset("runny-nose", "Runny or blocked nose", HealthKind.SYMPTOM, bodyPart = "nose"),
    HealthPreset("sneezing", "Sneezing", HealthKind.SYMPTOM, bodyPart = "nose", tags = listOf("allergy")),
    HealthPreset("sore-throat", "Sore throat", HealthKind.SYMPTOM, bodyPart = "throat"),
    HealthPreset("cough", "Cough", HealthKind.SYMPTOM, bodyPart = "lungs"),
    HealthPreset("shortness-of-breath", "Shortness of breath", HealthKind.SYMPTOM, bodyPart = "lungs"),
    HealthPreset("chest-pain", "Chest pain", HealthKind.SYMPTOM, bodyPart = "chest"),
    HealthPreset("palpitations", "Palpitations", HealthKind.SYMPTOM, bodyPart = "heart"),
    HealthPreset("nausea", "Nausea", HealthKind.SYMPTOM, bodyPart = "stomach"),
    HealthPreset("vomiting", "Vomiting", HealthKind.SYMPTOM, bodyPart = "stomach"),
    HealthPreset("diarrhea", "Diarrhea", HealthKind.SYMPTOM, bodyPart = "abdomen"),
    HealthPreset("constipation", "Constipation", HealthKind.SYMPTOM, bodyPart = "abdomen"),
    HealthPreset("stomach-ache", "Stomach ache", HealthKind.SYMPTOM, bodyPart = "stomach"),
    HealthPreset("heartburn", "Heartburn", HealthKind.SYMPTOM, bodyPart = "chest"),
    HealthPreset("back-pain", "Back pain", HealthKind.SYMPTOM, bodyPart = "back"),
    HealthPreset("joint-pain", "Joint pain", HealthKind.SYMPTOM, bodyPart = "joints"),
    HealthPreset("muscle-pain", "Muscle pain", HealthKind.SYMPTOM, bodyPart = "muscles"),
    HealthPreset("rash", "Rash", HealthKind.SYMPTOM, bodyPart = "skin"),
    HealthPreset("itching", "Itching", HealthKind.SYMPTOM, bodyPart = "skin"),
    HealthPreset("eye-irritation", "Eye irritation", HealthKind.SYMPTOM, bodyPart = "eyes"),
    HealthPreset("earache", "Earache", HealthKind.SYMPTOM, bodyPart = "ears"),
    HealthPreset("toothache", "Toothache", HealthKind.SYMPTOM, bodyPart = "mouth"),
    HealthPreset("insomnia", "Trouble sleeping", HealthKind.SYMPTOM),
    HealthPreset("anxiety", "Anxiety", HealthKind.SYMPTOM),
    HealthPreset("low-mood", "Low mood", HealthKind.SYMPTOM),
    HealthPreset("period-pain", "Period pain", HealthKind.SYMPTOM, bodyPart = "abdomen"),
    HealthPreset("swelling", "Swelling", HealthKind.SYMPTOM),
    HealthPreset("numbness", "Numbness or tingling", HealthKind.SYMPTOM),
)

val EVENT_PRESETS = listOf(
    HealthPreset("took-medication", "Took medication", HealthKind.MEDICATION),
    HealthPreset("vaccination", "Vaccination", HealthKind.MEDICATION, tags = listOf("vaccine")),
    HealthPreset("doctor-visit", "Doctor visit", HealthKind.LETTER),
    HealthPreset("injury", "Injury", HealthKind.SYMPTOM, tags = listOf("injury")),
    HealthPreset("allergic-reaction", "Allergic reaction", HealthKind.SYMPTOM, tags = listOf("allergy")),
    HealthPreset("fainting", "Fainting", HealthKind.SYMPTOM, bodyPart = "head"),
)

private val ALL_PRESETS = MEASUREMENT_PRESETS + SYMPTOM_PRESETS + EVENT_PRESETS

fun findPreset(id: String): HealthPreset? = ALL_PRESETS.firstOrNull { it.id == id }

/** Presets that start an entry of this kind, in list order, for the chips above the form. */
fun presetsFor(kind: HealthKind): List<HealthPreset> = ALL_PRESETS.filter { it.kind == kind }

/** Suggestions for the body-part field (`BODY_PARTS` in frontend/src/types.ts); free text is accepted too. */
val BODY_PARTS = listOf(
    "head", "eyes", "ears", "nose", "mouth", "throat", "neck", "chest", "heart", "lungs", "abdomen",
    "stomach", "back", "lower back", "hips", "shoulders", "arms", "elbows", "wrists", "hands",
    "fingers", "legs", "knees", "ankles", "feet", "skin", "joints", "muscles", "whole body",
)
