package com.hearth.attachments

import com.hearth.data.Blobs
import com.hearth.data.HealthKind
import com.hearth.data.JdbcSql
import com.hearth.data.NewHealthEntry
import com.hearth.data.Repo
import com.hearth.data.Sex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.nio.file.Files

/** Mirrors frontend/src/attachments/file.test.ts, plus the store. */
class AttachmentsTest {
    private fun bytes(vararg parts: Any): ByteArray {
        val out = mutableListOf<Byte>()
        for (p in parts) if (p is Int) out.add(p.toByte()) else for (c in p as String) out.add(c.code.toByte())
        return (out + List(16) { 0.toByte() }).toByteArray()
    }

    @Test fun `recognises the formats we accept and nothing else`() {
        assertEquals("image/jpeg", sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0)))
        assertEquals("image/png", sniffMime(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a)))
        assertEquals("image/webp", sniffMime(bytes("RIFF", 0, 0, 0, 0, "WEBP")))
        assertEquals("application/pdf", sniffMime(bytes("%PDF-1.7")))
        assertEquals("image/heic", sniffMime(bytes(0, 0, 0, 0x18, "ftypheic")))
        assertEquals("image/heif", sniffMime(bytes(0, 0, 0, 0x18, "ftypmif1")))
        assertNull(sniffMime(bytes("MZ", 0x90, 0)))
        assertNull(sniffMime(bytes("<!DOCTYPE html>")))
        assertNull(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04)))
        assertNull(sniffMime(byteArrayOf(0xff.toByte(), 0xd8.toByte())))
        assertNull(sniffMime(ByteArray(0)))
    }

    @Test fun `makes names safe to show`() {
        assertEquals("blood-count 2026.pdf", safeDisplayName("blood-count 2026.pdf"))
        assertEquals(".. .. etc passwd", safeDisplayName("../../etc/passwd"))
        assertEquals("scan .pdf", safeDisplayName("scan\u0000\u001f.pdf"))
        assertEquals(120, safeDisplayName("a".repeat(300)).length)
        assertEquals("document", safeDisplayName("   "))
        assertEquals("анализ крови.pdf", safeDisplayName("анализ крови.pdf"))
    }

    @Test fun `checks size and count`() {
        assertEquals(Rejection.TYPE, checkFile(10, null, 0))
        assertEquals(Rejection.SIZE, checkFile(0, "application/pdf", 0))
        assertEquals(Rejection.SIZE, checkFile(MAX_FILE_BYTES + 1, "application/pdf", 0))
        assertEquals(Rejection.COUNT, checkFile(10, "application/pdf", MAX_PER_ENTRY))
        assertNull(checkFile(10, "application/pdf", 0))
    }

    @Test fun `stores a file once, and deleting the last row removes it`() {
        val repo = Repo(JdbcSql(), Blobs(Files.createTempDirectory("blobs").toFile()))
        val p = repo.addPerson("a", "A", Sex.UNKNOWN, null)
        val e = repo.addHealthEntry(NewHealthEntry(p.id, "2026-01-01", "", HealthKind.LAB, "CBC", "", "", null, emptyList(), null, null, ""))
        val pdf = bytes("%PDF-1.7 hello")
        val a1 = addAttachment(repo, e.id, p.id, pdf, "../cbc.pdf", 0)
        val a2 = addAttachment(repo, e.id, p.id, pdf, "copy.pdf", 1)
        assertEquals(".. cbc.pdf", a1.name)
        assertEquals(listOf(Repo.attachmentBlobName(a1.sha256)), repo.blobs.list())
        assertEquals(pdf.size.toLong(), repo.attachmentBytesTotal())
        assertThrows(AttachmentException::class.java) { addAttachment(repo, e.id, p.id, bytes("MZ"), "x.exe", 0) }
        repo.deleteAttachment(a1.id)
        assertEquals(1, repo.blobs.list().size)
        repo.deleteAttachment(a2.id)
        assertEquals(emptyList<String>(), repo.blobs.list())
        assertNull(attachmentBytes(repo, a2))
    }
}
