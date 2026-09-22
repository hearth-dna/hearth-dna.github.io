package com.hearth.health

import com.hearth.data.HealthEntry
import com.hearth.data.HealthKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors frontend/src/health/log.test.ts, case for case where the function was ported. */
class HealthLogTest {
    private fun entry(
        id: String = "x",
        personId: String = "p",
        date: String = "2026-09-14",
        time: String = "",
        kind: HealthKind = HealthKind.SYMPTOM,
        title: String = "Pain",
        body: String = "",
        bodyPart: String = "",
        severity: Int? = null,
        tags: List<String> = emptyList(),
        value: Double? = null,
        unit: String = "",
        createdAt: String = "2026-09-14T00:00:00Z",
    ) = HealthEntry(id, personId, date, time, kind, title, body, "", bodyPart, severity, tags, value, null, unit, createdAt)

    @Test fun `parses loosely typed tag lists and round-trips`() {
        assertEquals(listOf("arthritis", "flare"), parseTags("Arthritis, flare ,,Flare, "))
        assertEquals(emptyList<String>(), parseTags(""))
        assertEquals("a, b", formatTags(listOf("a", "b")))
        assertEquals(listOf("a", "b"), parseTags(formatTags(listOf("a", "b"))))
    }

    @Test fun `formats single values, pairs and missing units like JavaScript`() {
        assertEquals("", formatValue(null, null, "°C"))
        assertEquals("72", formatValue(72.0, null, ""))
        assertEquals("37.8 °C", formatValue(37.8, null, "°C"))
        assertEquals("120/80 mmHg", formatValue(120.0, 80.0, "mmHg"))
        assertNull(findPreset("nope"))
        assertEquals("mmHg", findPreset("blood-pressure")?.unit)
    }

    private val log = listOf(
        entry(id = "1", title = "Pain in hands", bodyPart = "hands", severity = 6, tags = listOf("arthritis")),
        entry(id = "2", title = "Headache", bodyPart = "head", severity = 3, tags = listOf("migraine")),
        entry(id = "3", kind = HealthKind.LAB, title = "CRP", body = "CRP 12 mg/L", tags = listOf("arthritis")),
        entry(id = "4", kind = HealthKind.MEASUREMENT, title = "Temperature", value = 38.2, unit = "°C"),
    )

    private fun ids(f: HealthFilter) = filterHealthLog(log, f).map { it.id }

    @Test fun `filters by kind, body part, tag and text`() {
        assertEquals(listOf("1", "2", "3", "4"), ids(HealthFilter()))
        assertEquals(listOf("1", "2"), ids(HealthFilter(kind = HealthKind.SYMPTOM)))
        assertEquals(listOf("2"), ids(HealthFilter(bodyPart = "head")))
        assertEquals(listOf("1", "3"), ids(HealthFilter(tag = "arthritis")))
        assertEquals(listOf("3"), ids(HealthFilter(tag = "arthritis", kind = HealthKind.LAB)))
        assertEquals(listOf("1"), ids(HealthFilter(text = "HAND")))
        assertEquals(listOf("3"), ids(HealthFilter(text = "mg/l")))
        assertEquals(listOf("2"), ids(HealthFilter(text = "migr")))
        assertEquals(listOf("4"), ids(HealthFilter(text = "°c")))
    }

    @Test fun `filters by person, date range and minimum severity`() {
        val more = listOf(
            entry(id = "a", personId = "p1", date = "2026-01-05", severity = 2),
            entry(id = "b", personId = "p2", date = "2026-02-10", severity = 7),
            entry(id = "c", personId = "p1", date = "2026-03-15"),
        )
        fun f(filter: HealthFilter) = filterHealthLog(more, filter).map { it.id }
        assertEquals(listOf("a", "c"), f(HealthFilter(person = "p1")))
        assertEquals(listOf("b", "c"), f(HealthFilter(from = "2026-02-10")))
        assertEquals(listOf("a", "b"), f(HealthFilter(to = "2026-02-10")))
        assertEquals(listOf("b"), f(HealthFilter(minSeverity = 3)))
        assertFalse(HealthFilter().isFiltering)
        assertTrue(HealthFilter(minSeverity = 1).isFiltering)
    }

    @Test fun `counts panel filters, a date range once, and ignores kind and search`() {
        assertEquals(0, HealthFilter().panelCount)
        assertEquals(0, HealthFilter(kind = HealthKind.LAB, text = "x").panelCount)
        assertEquals(2, HealthFilter(from = "2026-01-01", to = "2026-02-01", tag = "a").panelCount)
        assertEquals(4, HealthFilter(person = "p", bodyPart = "hands", minSeverity = 1, to = "2026-01-01").panelCount)
    }

    @Test fun `lists distinct facets sorted`() {
        assertEquals(Facets(listOf("hands", "head"), listOf("arthritis", "migraine")), facets(log))
    }

    private val sortLog = listOf(
        entry(id = "1", personId = "b", date = "2026-01-01", kind = HealthKind.LAB, title = "CRP", createdAt = "1"),
        entry(id = "2", personId = "a", date = "2026-03-01", title = "ache", severity = 4, createdAt = "2"),
        entry(id = "3", personId = "a", date = "2026-02-01", kind = HealthKind.MEASUREMENT, title = "Weight", value = 70.0, createdAt = "3"),
        entry(id = "4", personId = "b", date = "2026-03-01", title = "Back pain", severity = 8, createdAt = "4"),
    )

    private fun sorted(k: SortKey, d: SortDir, name: (String) -> String = { it }) = sortHealthLog(sortLog, k, d, name).map { it.id }

    @Test fun `sorts by date both ways, ties newest-created first`() {
        assertEquals(listOf("4", "2", "3", "1"), sorted(SortKey.DATE, SortDir.DESC))
        assertEquals(listOf("1", "3", "4", "2"), sorted(SortKey.DATE, SortDir.ASC))
    }

    @Test fun `keeps empty values last in either direction`() {
        assertEquals(listOf("4", "2", "3", "1"), sorted(SortKey.SEVERITY, SortDir.DESC))
        assertEquals(listOf("2", "4", "3", "1"), sorted(SortKey.SEVERITY, SortDir.ASC))
        assertEquals("3", sorted(SortKey.VALUE, SortDir.ASC)[0])
    }

    @Test fun `sorts titles case-insensitively and people by display name`() {
        assertEquals(listOf("2", "4", "1", "3"), sorted(SortKey.TITLE, SortDir.ASC))
        assertEquals(listOf("4", "1", "2", "3"), sorted(SortKey.PERSON, SortDir.ASC) { if (it == "a") "Zoe" else "Adam" })
    }

    @Test fun `normalises HH-MM and rejects anything else`() {
        assertEquals("08:05", normTime("8:05"))
        assertEquals("23:59", normTime("23:59"))
        assertEquals("07:30", normTime("07:30:12"))
        assertEquals("", normTime("24:00"))
        assertEquals("", normTime("12:60"))
        assertEquals("", normTime("noon"))
        assertEquals("", normTime(""))
    }

    @Test fun `orders same-day entries by time, untimed ones first when ascending`() {
        val day = listOf(
            entry(id = "evening", time = "21:00", createdAt = "1"),
            entry(id = "untimed", time = "", createdAt = "2"),
            entry(id = "morning", time = "07:00", createdAt = "3"),
        )
        assertEquals(listOf("evening", "morning", "untimed"), sortHealthLog(day, SortKey.DATE, SortDir.DESC).map { it.id })
        assertEquals(listOf("untimed", "morning", "evening"), sortHealthLog(day, SortKey.DATE, SortDir.ASC).map { it.id })
    }

    @Test fun `steps back across months, years and leap days`() {
        assertEquals("2026-09-14", daysBefore("2026-09-14", 0))
        assertEquals("2026-02-28", daysBefore("2026-03-01", 1))
        assertEquals("2024-02-29", daysBefore("2024-03-01", 1))
        assertEquals("2025-12-28", daysBefore("2026-01-03", 6))
    }

    @Test fun `groups consecutive entries by date, keeping order`() {
        val g = groupByDate(listOf(entry(id = "a"), entry(id = "b"), entry(id = "c", date = "2026-09-12")))
        assertEquals(listOf("2026-09-14" to listOf("a", "b"), "2026-09-12" to listOf("c")), g.map { (d, es) -> d to es.map { it.id } })
    }
}
