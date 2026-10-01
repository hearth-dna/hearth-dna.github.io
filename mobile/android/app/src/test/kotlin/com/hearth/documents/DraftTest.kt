package com.hearth.documents

import com.hearth.data.HealthKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors frontend/src/documents/draft.test.ts. */
class DraftTest {
    @Test fun `folds lab values into the body`() {
        val d = draftFromJson(
            """{"date":"2026-05-01","kind":"lab","title":"Lipid panel","body":"Fasting sample.","values":[{"name":"LDL","value":"4.1","unit":"mmol/L","ref":"< 3.0"},{"name":"HDL","value":"1.2"}]}""",
            "2026-09-13",
        )
        assertEquals(HealthDraft("2026-05-01", HealthKind.LAB, "Lipid panel", "Fasting sample.\n\nLDL: 4.1 mmol/L (ref < 3.0)\nHDL: 1.2"), d)
    }

    @Test fun `falls back on bad date, unknown kind and empty title`() {
        assertEquals(
            HealthDraft("2026-09-13", HealthKind.OTHER, "Untitled document", "ok"),
            draftFromJson("""{"date":"May 2026","kind":"xray","title":"","body":"ok","values":[]}""", "2026-09-13"),
        )
    }

    @Test fun `asks for transcription only`() {
        val p = documentPrompt("imaging")
        assertTrue(p.contains("imaging report"))
        assertTrue(p.contains("Do not add interpretation"))
        assertTrue(p.contains("Leave out patient name"))
    }
}
