package com.hearth

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File

/** Mirrors frontend/src/egress/egress.test.ts: one gateway, and it refuses what it must. */
class EgressTest {
    /** Anything that can open a connection; only Egress.kt may name these. */
    private val NETWORK = Regex("""openConnection|HttpURLConnection|HttpsURLConnection|java\.net\.Socket|okhttp|URL\(""")

    @Test fun `nothing but Egress opens a connection`() {
        val offenders = File("src/main/kotlin").walk().filter { it.isFile && it.name.endsWith(".kt") && it.name != "Egress.kt" }
            .filter { NETWORK.containsMatchIn(it.readText()) }.map { it.name }.toList()
        assertEquals(emptyList<String>(), offenders)
    }

    @Test fun `refuses other hosts, plain http and unconfirmed sends`() {
        assertThrows(IllegalArgumentException::class.java) { Egress.request("GET", "https://evil.example/x") }
        assertThrows(IllegalArgumentException::class.java) { Egress.request("GET", "http://www.googleapis.com/x") }
        assertThrows(IllegalArgumentException::class.java) { Egress.readDocumentWithGemini("k", null, emptyList(), "p", JSONObject(), null) }
        assertThrows(IllegalArgumentException::class.java) { Egress.readDocumentWithGemini("", null, emptyList(), "p", JSONObject(), "now") }
    }
}
