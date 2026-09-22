package com.hearth

import java.io.ByteArrayInputStream
import java.io.InputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** The pure half of [Files]: names, chunking and the reply shape. The SAF calls need a device. */
class FilesTest {
    @Test
    fun `accepts the names the web app uses`() {
        for (name in listOf("hearth-backup.hearth", "hearth-backup.hearth.1", "README.txt", "attachments")) {
            assertEquals(name, Files.safeName(name))
        }
    }

    @Test
    fun `refuses anything that looks like a path`() {
        for (name in listOf("", ".", "..", "a/b", "../x", "nul\u0000l")) {
            assertThrows(IllegalArgumentException::class.java) { Files.safeName(name) }
        }
    }

    @Test
    fun `fills a chunk even from a stream that returns short reads`() {
        val data = ByteArray(10) { it.toByte() }
        val trickle = object : InputStream() {
            private val inner = ByteArrayInputStream(data)
            override fun read() = inner.read()
            override fun read(b: ByteArray, off: Int, len: Int) = inner.read(b, off, minOf(len, 3))
        }
        assertArrayEquals(data.copyOf(8), Files.readChunk(trickle, 8))
        assertArrayEquals(data.copyOfRange(8, 10), Files.readChunk(trickle, 8))
        assertEquals(0, Files.readChunk(trickle, 8).size)
    }
}
