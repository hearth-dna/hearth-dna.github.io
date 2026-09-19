package com.hearth

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The naming half of the save path. It runs on the JVM with no device and no Robolectric: these
 * are pure functions on strings, and the rest of [Downloads] is one MediaStore call per chunk.
 */
class DownloadsTest {
    @Test
    fun `takes the name the web app asked for`() {
        assertEquals(
            "hearth-dump-2026-09-19.hearth",
            Downloads.fileName("attachment; filename=\"hearth-dump-2026-09-19.hearth\"", null),
        )
    }

    @Test
    fun `reads an encrypted dump name and the RFC 5987 form`() {
        assertEquals(
            "hearth-dump-2026-09-19.hearth.enc",
            Downloads.fileName("attachment; filename*=UTF-8''hearth-dump-2026-09-19.hearth.enc", null),
        )
    }

    @Test
    fun `falls back to the MIME type when there is no disposition`() {
        assertEquals("hearth-export.csv", Downloads.fileName(null, "text/csv"))
        assertEquals("hearth-export.json", Downloads.fileName("", "application/json"))
        assertEquals("hearth-export.bin", Downloads.fileName(null, null))
    }

    @Test
    fun `a name is never a path`() {
        assertEquals("passwd", Downloads.sanitise("../../../etc/passwd"))
        assertEquals("dump.hearth", Downloads.sanitise("C:\\Windows\\dump.hearth"))
    }

    @Test
    fun `control characters and blank names cannot survive`() {
        assertEquals("dump.hearth", Downloads.sanitise("dump\u0000.hearth\n"))
        assertEquals("hearth-export.bin", Downloads.sanitise("   "))
    }

    @Test
    fun `a name stays short enough for any filesystem`() {
        assertEquals(120, Downloads.sanitise("a".repeat(400)).length)
    }
}
