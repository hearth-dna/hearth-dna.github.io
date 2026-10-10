package com.hearth.ask

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.net.URI
import java.net.URLDecoder

/** Mirrors frontend/src/ask/assistants.test.ts. */
class AssistantsTest {
    private fun by(id: String) = ASSISTANTS.first { it.id == id }

    @Test fun `puts the text, encoded, in each provider's prefill parameter`() {
        val text = "Person A: CYP2C19 *2/*2 & clopidogrel?\nПочему? (ok) it's ~fine!"
        for (a in ASSISTANTS) {
            val url = URI(assistantUrl(a, text)!!)
            assertEquals(a.id, "https", url.scheme)
            val q = url.rawQuery.split("&").last { it.startsWith("q=") }.removePrefix("q=")
            assertEquals(a.id, text, URLDecoder.decode(q.replace("+", "%2B"), "UTF-8"))
            assertEquals(a.id, -1, q.indexOf(' '))
        }
        assertEquals("https://www.google.com/search?udm=50&q=x", assistantUrl(by("google"), "x"))
        assertEquals("https://claude.ai/new?q=x", assistantUrl(by("claude"), "x"))
    }

    @Test fun `encodes like encodeURIComponent`() {
        assertEquals("a%20b%26c!'()*~-_.", encodeURIComponent("a b&c!'()*~-_."))
        assertEquals("%D0%B6", encodeURIComponent("ж"))
    }

    @Test fun `refuses a text too long for an address`() {
        assertNull(assistantUrl(by("chatgpt"), "a".repeat(MAX_URL)))
        assertNotNull(assistantUrl(by("chatgpt"), "a".repeat(MAX_URL - 100)))
    }
}
