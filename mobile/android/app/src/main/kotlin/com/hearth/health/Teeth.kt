package com.hearth.health

import com.hearth.i18n.Strings
import org.json.JSONObject

/**
 * Port of frontend/src/health/teeth.ts. Teeth by their FDI (ISO 3950) number: quadrants 1–4 hold
 * the 32 permanent teeth (11–48), quadrants 5–8 the 20 milk teeth (51–85), so the number alone says
 * whether a tooth is a milk tooth. An entry stores its teeth in `details` as `{"teeth":"16 26 55"}`.
 */

private fun rows(right: Pair<Int, Int>, left: Pair<Int, Int>, n: Int): List<List<Int>> = listOf(
    (n downTo 1).map { right.first * 10 + it } + (1..n).map { left.first * 10 + it },
    (n downTo 1).map { right.second * 10 + it } + (1..n).map { left.second * 10 + it },
)

/** [upper jaw, lower jaw], each the person's right → left. */
val PERMANENT_TEETH = rows(1 to 4, 2 to 3, 8)
val MILK_TEETH = rows(5 to 8, 6 to 7, 5)

private val ALL_TEETH = (PERMANENT_TEETH.flatten() + MILK_TEETH.flatten()).toSet()

fun isMilkTooth(n: Int) = n / 10 >= 5

/** "26 16 x 16 99 55,19" → [16, 26, 55]: valid FDI numbers only, ascending, each once. */
fun parseTeeth(v: String?): List<Int> =
    (v ?: "").split(Regex("[\\s,;]+")).mapNotNull { it.toIntOrNull() }.filter { it in ALL_TEETH }.distinct().sorted()

/** Inverse of [parseTeeth]; "" when there are none. */
fun formatTeeth(teeth: List<Int>): String = teeth.sorted().joinToString(" ")

/** Adds the tooth, or takes it out when it is already there. */
fun toggleTooth(teeth: List<Int>, n: Int): List<Int> = if (n in teeth) teeth - n else (teeth + n).sorted()

/** What kind of tooth it is: incisor, canine, premolar or molar (the `detail.teeth.*` keys). */
fun toothType(n: Int): String {
    val i = n % 10
    return when {
        i <= 2 -> "incisor"
        i == 3 -> "canine"
        isMilkTooth(n) || i >= 6 -> "molar"
        else -> "premolar"
    }
}

/** The teeth an entry names, from its `details` JSON; empty when none or unreadable. */
fun teethOf(details: String): List<Int> =
    if (details.isBlank()) emptyList() else runCatching { parseTeeth(JSONObject(details).optString("teeth")) }.getOrDefault(emptyList())

/** `details` holding these teeth, as the web writes it; "" when there are none. */
fun detailsWithTeeth(teeth: List<Int>): String =
    if (teeth.isEmpty()) "" else JSONObject().put("teeth", formatTeeth(teeth)).toString()

/** "Teeth 16, 26 · Milk teeth 55", translated; "" when there are none. */
fun teethText(teeth: List<Int>, t: Strings): String {
    val (milk, permanent) = teeth.partition(::isMilkTooth)
    return listOfNotNull(
        permanent.takeIf { it.isNotEmpty() }?.let { t("detail.teethShort", "list" to it.joinToString(", ")) },
        milk.takeIf { it.isNotEmpty() }?.let { t("detail.milkShort", "list" to it.joinToString(", ")) },
    ).joinToString(" · ")
}
