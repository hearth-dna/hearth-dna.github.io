package com.hearth.health

import com.hearth.data.HealthKind
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The presets are a hand-kept copy of frontend/src/health/presets.ts; this keeps them in step. */
class PresetsTest {
    private val web = File("../../../frontend/src/health/presets.ts").readText()
    private val synonyms = JSONObject(File("../../../frontend/src/health/synonyms.json").readText())

    private fun webIds(call: String) = Regex("""\b$call\(\s*'([a-z0-9-]+)'""").findAll(web).map { it.groupValues[1] }.toList()

    @Test fun `has the web's measurement and symptom presets in the web's order`() {
        assertEquals(webIds("m"), MEASUREMENT_PRESETS.map { it.id })
        assertEquals(webIds("s"), SYMPTOM_PRESETS.map { it.id })
    }

    @Test fun `has the web's symptom synonyms`() {
        for (p in SYMPTOM_PRESETS + EVENT_PRESETS.filter { it.kind == HealthKind.SYMPTOM }) {
            val want = synonyms.optJSONArray(p.id)?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
            assertEquals(p.id, want, p.synonyms)
        }
    }

    private fun e(kind: HealthKind, title: String) = com.hearth.data.HealthEntry("x", "p", "2026-09-14", "", kind, title, "", "", "", null, emptyList(), null, null, "", "")
    private val t = { key: String -> "T($key)" }

    @Test fun `names an entry by its preset in the UI language, whatever name it was saved under`() {
        assertEquals("T(preset.headache)", entryTitle(e(HealthKind.SYMPTOM, "Headache"), t))
        assertEquals("T(preset.headache)", entryTitle(e(HealthKind.SYMPTOM, "  ГОЛОВНАЯ боль "), t))
        assertEquals("T(preset.eye-irritation)", entryTitle(e(HealthKind.SYMPTOM, "Eye irritation"), t))
        assertEquals("T(preset.weight)", entryTitle(e(HealthKind.MEASUREMENT, "вес"), t))
        assertEquals("T(preset.injury)", entryTitle(e(HealthKind.SYMPTOM, "Injury"), t))
        // Another kind's preset does not claim the entry, and an unknown title stays as typed.
        assertEquals("Headache", entryTitle(e(HealthKind.OTHER, "Headache"), t))
        assertEquals("Knee clicks", entryTitle(e(HealthKind.SYMPTOM, "Knee clicks"), t))
        assertNull(presetOf(HealthKind.SYMPTOM, ""))
    }

    @Test fun `searches and sorts by the shown name`() {
        val a = e(HealthKind.SYMPTOM, "Headache").copy(id = "a")
        val b = e(HealthKind.SYMPTOM, "Fever").copy(id = "b")
        val shown = { x: com.hearth.data.HealthEntry -> if (x.id == "a") "Zzz" else "Aaa" }
        assertEquals(listOf("a"), filterHealthLog(listOf(a, b), HealthFilter(text = "zz"), shown).map { it.id })
        assertEquals(listOf("a"), filterHealthLog(listOf(a, b), HealthFilter(text = "headache"), shown).map { it.id })
        assertEquals(listOf("b", "a"), sortHealthLog(listOf(a, b), SortKey.TITLE, SortDir.ASC, title = shown).map { it.id })
        assertTrue(presetsFor(HealthKind.SYMPTOM).size > 60)
    }
}
