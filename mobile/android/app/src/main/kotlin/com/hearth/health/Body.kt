package com.hearth.health

import com.hearth.data.HealthEntry
import java.time.LocalDate
import kotlin.math.ceil

/**
 * Port of frontend/src/health/body.ts: which body part each entry names, and how many entries each
 * part (each side of a paired part, each tooth) has, for the body map's heat. BodyTest mirrors
 * body.test.ts.
 */

/** Paired parts: drawn once per side, and filterable by side. */
val PAIRED = setOf(
    "eyes", "ears", "lungs", "shoulders", "armpit", "hips", "arms", "elbows", "wrists", "hands", "fingers",
    "legs", "knees", "ankles", "feet",
)

private val KNOWN = BODY_PARTS.toSet()
private val SINGULAR = mapOf("foot" to "feet", "tooth" to "mouth", "teeth" to "mouth")

/** The body part an entry names: one of [BODY_PARTS] when it is one ("Knee" → "knees"), else the text lower-cased. */
fun bodyKey(text: String): String {
    val k = text.trim().lowercase().replace(Regex("\\s+"), " ")
    if (k.isEmpty() || k in KNOWN) return k
    SINGULAR[k]?.let { return it }
    if ("${k}s" in KNOWN) return "${k}s"
    return k
}

/** Whether an entry on `side` belongs to the map's `want` side: its own, both sides, or none recorded. */
fun onSide(side: String, want: String) = want.isEmpty() || side == want || side == "both" || side.isEmpty()

class BodyHeat(
    /** Entries per part, as [bodyKey] names it. */
    val parts: Map<String, Int>,
    /** Of those, the ones on each side (left to right), for paired parts. */
    val sides: Map<String, Pair<Int, Int>>,
    /** The largest count of any drawn part or side (at least 1): the top of the colour scale. */
    val max: Int,
)

fun bodyHeat(entries: List<HealthEntry>): BodyHeat {
    val parts = mutableMapOf<String, Int>()
    val sides = mutableMapOf<String, Pair<Int, Int>>()
    for (e in entries) {
        val k = bodyKey(e.bodyPart)
        if (k.isEmpty()) continue
        parts[k] = (parts[k] ?: 0) + 1
        if (k !in PAIRED) continue
        val (l, r) = sides[k] ?: (0 to 0)
        sides[k] = (l + if (onSide(e.side, "left")) 1 else 0) to (r + if (onSide(e.side, "right")) 1 else 0)
    }
    var max = 1
    for ((k, n) in parts) max = maxOf(max, sides[k]?.let { maxOf(it.first, it.second) } ?: n)
    return BodyHeat(parts, sides, max)
}

/** How many entries one region stands for: the part, or one side of a paired part. */
fun regionCount(heat: BodyHeat, part: String, side: String = ""): Int = when (side) {
    "left" -> heat.sides[part]?.first ?: 0
    "right" -> heat.sides[part]?.second ?: 0
    else -> heat.parts[part] ?: 0
}

/** Steps of the colour scale; 0 is "none". */
const val HEAT_STEPS = 5

/** 0 for none, else 1–[HEAT_STEPS] in proportion to the busiest part. */
fun heatLevel(n: Int, max: Int): Int =
    if (n <= 0) 0 else maxOf(1, ceil(n.toDouble() / maxOf(max, 1) * HEAT_STEPS).toInt())

/** Entries per tooth (FDI number), from the teeth dental entries name. */
fun teethHeat(entries: List<HealthEntry>): Map<Int, Int> {
    val out = mutableMapOf<Int, Int>()
    for (e in entries) for (n in teethOf(e.details)) out[n] = (out[n] ?: 0) + 1
    return out
}

/** Age groups the map draws (frontend/src/components/bodyWarp.ts `STAGES`), oldest first. */
val STAGES = listOf("adult", "teen", "child", "young", "toddler")
private val FROM = mapOf("adult" to 16.0, "teen" to 13.0, "child" to 9.0, "young" to 4.0, "toddler" to 0.0)

/** The age group for an age in years; adult when unknown. */
fun stageOf(age: Double?): String = if (age == null) "adult" else STAGES.firstOrNull { age >= FROM.getValue(it) } ?: "toddler"

/** Age in years from a birth year alone (the phones keep no birth date), counted from mid-year. */
fun ageFromYear(birthYear: Int?, today: LocalDate = LocalDate.now()): Double? =
    birthYear?.let { (today.toEpochDay() - LocalDate.of(it, 7, 1).toEpochDay()) / 365.25 }
