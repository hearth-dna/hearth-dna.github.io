package com.hearth.backup

import com.hearth.data.JdbcSql
import com.hearth.data.Repo
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** The golden backups in mobile/fixtures/ (test resources), written by the web app's own code. */
class RestoreTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource(name)!!.readBytes()
    private val journal = JSONObject(String(fixture("journal.json")))
    private val passphrase = "correct horse battery staple"

    @Test fun `derives PBKDF2-HMAC-SHA256 keys to the published vectors`() {
        fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
        assertEquals("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b", hex(pbkdf2Sha256("password", "salt".toByteArray(), 1)))
        assertEquals("c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a", hex(pbkdf2Sha256("password", "salt".toByteArray(), 4096)))
    }

    @Test fun `opens the plain and the encrypted fixture to the same journal`() {
        val plain = openContainer(fixture("plain.hearth"))
        assertEquals(norm(journal), norm(plain.journal))
        assertEquals(7, plain.header.getInt("generation"))
        val enc = fixture("encrypted.hearth")
        assertTrue(isEncrypted(enc))
        assertEquals(norm(journal), norm(openContainer(enc, passphrase).journal))
        assertThrows(BackupException::class.java) { openContainer(enc) }
        assertThrows(BackupException::class.java) { openContainer(enc, "wrong") }
        assertThrows(BackupException::class.java) { openContainer("not a zip".toByteArray()) }
    }

    @Test fun `restores every row, and a second restore changes nothing`() {
        val sql = JdbcSql()
        val c = openContainer(fixture("plain.hearth"))
        val first = restore(sql, c)
        assertEquals(RestoreResult(persons = 2, healthEntries = 4, skippedGenomes = 0, skippedAttachmentFiles = 1), first)
        assertEquals(RestoreResult(0, 0, 0, 1), restore(sql, c))

        fun rows(table: String, order: String) = sql.query("SELECT * FROM $table ORDER BY $order")
        assertSame(journal.getJSONArray("persons"), rows("person", "created_at"))
        assertSame(journal.getJSONArray("notes"), rows("note", "id"))
        assertSame(journal.getJSONArray("attachments"), rows("attachment", "id"))
        assertEquals(listOf(mapOf("parent_id" to "p-alex", "child_id" to "p-sam")), rows("relationship", "parent_id"))
        assertEquals(2, rows("consent", "id").size)
        assertEquals(1, rows("sharing_log", "id").size)

        // h-4 comes without the later columns and gets the web's defaults.
        val h4 = sql.query("SELECT * FROM health_log WHERE id='h-4'").single()
        assertEquals("", h4["tags"])
        assertEquals(null, h4["value"])

        val repo = Repo(sql)
        val bp = repo.listHealthLog().first { it.id == "h-1" }
        assertEquals(128.0, bp.value)
        assertEquals(84.0, bp.value2)
        assertEquals(listOf("arthritis", "flare"), repo.listHealthLog().first { it.id == "h-2" }.tags)
        assertTrue(repo.hasConsent(com.hearth.data.ConsentKind.IMPORT_DOCUMENT, "p-alex"))
    }

    /** JSON as plain Kotlin values, numbers as Double, so two documents compare by content. */
    private fun norm(v: Any?): Any? = when (v) {
        is JSONObject -> v.keys().asSequence().associateWith { norm(v.get(it)) }
        is JSONArray -> (0 until v.length()).map { norm(v.get(it)) }
        is Number -> v.toDouble()
        JSONObject.NULL -> null
        else -> v
    }

    /** Every column of every journal row made it into the table unchanged. */
    private fun assertSame(expected: JSONArray, actual: List<Map<String, Any?>>) {
        assertEquals(expected.length(), actual.size)
        for (i in 0 until expected.length()) {
            val o = expected.getJSONObject(i)
            for (k in o.keys()) {
                val want = o.get(k).takeUnless { it == JSONObject.NULL }
                val got = actual[i][k]
                if (want is Number) assertEquals(k, want.toDouble(), (got as Number).toDouble(), 0.0)
                else assertEquals(k, want, got)
            }
        }
    }
}
