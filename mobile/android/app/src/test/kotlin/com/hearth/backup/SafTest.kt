package com.hearth.backup

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream

/** The pure half of the picker places: names and reading a file's first bytes. The SAF calls need a device. */
class SafTest {
    @Test fun `accepts the names a backup uses`() {
        for (name in listOf("hearth-backup.hearth", "hearth-backup.hearth.1", "README.txt", "attachments")) assertEquals(name, safeName(name))
    }

    @Test fun `refuses anything that looks like a path`() {
        for (name in listOf("", ".", "..", "a/b", "../x", "nul\u0000l")) assertThrows(IllegalArgumentException::class.java) { safeName(name) }
    }

    @Test fun `reads a head even from a stream that returns short reads`() {
        val data = ByteArray(10) { it.toByte() }
        fun trickle() = object : InputStream() {
            private val inner = ByteArrayInputStream(data)
            override fun read() = inner.read()
            override fun read(b: ByteArray, off: Int, len: Int) = inner.read(b, off, minOf(len, 3))
        }
        assertArrayEquals(data.copyOf(8), readUpTo(trickle(), 8))
        assertArrayEquals(data, readUpTo(trickle(), 64))
    }
}
