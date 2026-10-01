package com.hearth.backup

import com.hearth.data.Blobs
import com.hearth.data.JdbcSql
import com.hearth.data.Repo
import com.hearth.genome.sha256Hex
import java.nio.file.Files
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

    private fun newRepo() = Repo(JdbcSql(), Blobs(Files.createTempDirectory("blobs").toFile()))

    @Test fun `restores every row, and a second restore changes nothing`() {
        val repo = newRepo()
        val sql = repo.sql
        val c = openContainer(fixture("plain.hearth"))
        val first = restore(repo, c)
        assertEquals(RestoreResult(persons = 2, healthEntries = 4, genomes = 0, skippedAttachmentFiles = 1, exportedAt = "2026-09-21T00:00:00.000Z"), first)
        assertEquals(first.copy(persons = 0, healthEntries = 0), restore(repo, c))

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

        val bp = repo.listHealthLog().first { it.id == "h-1" }
        assertEquals(128.0, bp.value)
        assertEquals(84.0, bp.value2)
        assertEquals(listOf("arthritis", "flare"), repo.listHealthLog().first { it.id == "h-2" }.tags)
        assertTrue(repo.hasConsent(com.hearth.data.ConsentKind.IMPORT_DOCUMENT, "p-alex"))
    }

    @Test fun `restores both genomes, keeps the originals, and does not load them twice`() {
        val repo = newRepo()
        val c = openContainer(fixture("genomes.hearth"))
        assertEquals(2, c.genomes.size)
        assertEquals(2, restore(repo, c).genomes)
        assertEquals(mapOf("p-alex" to 7, "p-sam" to 7), repo.genotypeCounts())
        val sam = repo.familyAt("rs429358").first { it.personId == "p-sam" }.call
        assertEquals("T" to "T", sam.a1 to sam.a2)
        // The originals are kept under the hash of their text, which the source_file rows name.
        val shas = repo.listSourceFiles().map { it.sha256 }.toSet()
        assertEquals(shas.map { Repo.genomeBlobName(it) }.toSet(), repo.blobs.list().toSet())
        for (name in repo.blobs.list()) {
            val text = com.hearth.genome.decode(com.hearth.genome.gunzip(repo.blobs.get(name)!!))
            assertEquals(name, Repo.genomeBlobName(sha256Hex(text)))
        }
        assertEquals(0, restore(repo, c).genomes)
        // Sam's rs4680 is AA against Alex's GG: one violation among the six autosomal calls.
        val m = repo.mendelian("p-sam", "p-alex")
        assertEquals(6, m.compared)
        assertEquals(1, m.violations)
    }

    @Test fun `refuses a genome whose bytes do not match the manifest`() {
        val bytes = fixture("genomes.hearth")
        val c = openContainer(bytes)
        val path = c.genomeEntries.first().path
        // Flip a byte inside the stored (uncompressed) zip entry of the first genome.
        val at = String(bytes, Charsets.ISO_8859_1).indexOf(path) + path.length + 20
        val broken = bytes.copyOf().also { it[at] = (it[at].toInt() xor 1).toByte() }
        assertThrows(BackupException::class.java) { openContainer(broken) }
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
