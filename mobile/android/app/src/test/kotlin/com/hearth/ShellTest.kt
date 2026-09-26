package com.hearth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The two pure decisions of the shell around the web app: asset types, and when to offer the camera. */
class ShellTest {
    @Test
    fun `serves module workers and wasm with the exact types`() {
        assertEquals("text/javascript", HearthWebView.mimeOverride("assets/pdf.worker.min-BmVo14Nb.mjs"))
        assertEquals("text/javascript", HearthWebView.mimeOverride("assets/index-abc.js"))
        assertEquals("application/wasm", HearthWebView.mimeOverride("assets/sqlite3.wasm"))
        assertNull(HearthWebView.mimeOverride("index.html"))
        assertNull(HearthWebView.mimeOverride("import/document"))
    }

    @Test
    fun `offers the camera only where a picture is accepted`() {
        // The document reader's input.
        assertTrue(Camera.wantsImages(arrayOf("image/jpeg,image/png,image/webp,image/heic,application/pdf")))
        assertTrue(Camera.wantsImages(arrayOf("image/*")))
        assertTrue(Camera.wantsImages(arrayOf(".JPG")))
        // No accept attribute means any file, a photo included.
        assertTrue(Camera.wantsImages(arrayOf("")))
        assertTrue(Camera.wantsImages(arrayOf()))
        // DNA files, CSV timelines and backups.
        assertFalse(Camera.wantsImages(arrayOf(".txt,.csv,.vcf,.zip,.gz,.tsv")))
        assertFalse(Camera.wantsImages(arrayOf(".csv", ".tsv", "text/csv")))
        assertFalse(Camera.wantsImages(arrayOf(".hearth,.enc,.gz,.json,.html")))
    }
}
