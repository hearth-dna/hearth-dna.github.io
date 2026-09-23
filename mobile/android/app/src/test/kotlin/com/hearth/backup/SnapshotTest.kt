package com.hearth.backup

import com.hearth.data.Blobs
import com.hearth.data.JdbcSql
import com.hearth.data.Repo
import com.hearth.genome.gzip
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * A backup written here restores to the same family, plain and sealed, and the web opens it:
 * `UPDATE_FIXTURES=1` writes mobile/fixtures/android.hearth, which frontend/src/export/fixtures.test.ts
 * restores and compares with the genome fixture's journal.
 */
class SnapshotTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource(name)!!.readBytes()
    private fun newRepo() = Repo(JdbcSql(), Blobs(Files.createTempDirectory("blobs").toFile()))

    private fun loaded(): Repo = newRepo().also { restore(it, openContainer(fixture("genomes.hearth"))) }

    /** Table contents as sorted JSON strings, for comparing two databases. */
    private fun dump(repo: Repo) = listOf("person", "relationship", "source_file", "health_log", "attachment", "note", "genotype")
        .associateWith { t -> repo.sql.query("SELECT * FROM $t").map { JSONObject(it).toString() }.sorted() }

    @Test fun `a snapshot restores to the same family, genomes included`() {
        val a = loaded()
        for (pass in listOf(null, "trés secret")) {
            val bytes = snapshotBytes(a, "test", pass)
            assertEquals(pass != null, isEncrypted(bytes))
            val b = newRepo()
            val r = restoreBytes(b, bytes, pass)
            assertEquals(2, r.genomes)
            assertEquals(dump(a), dump(b))
            assertEquals(a.getMeta("generation"), openContainer(bytes, pass).header.getLong("generation").toString())
        }
    }

    @Test fun `header json is the first entry, stored, so a folder can read it from the first bytes`() {
        val bytes = snapshotBytes(loaded(), "test")
        assertEquals(0x04034b50, (bytes[0].toInt() and 0xff) or ((bytes[1].toInt() and 0xff) shl 8) or ((bytes[2].toInt() and 0xff) shl 16) or ((bytes[3].toInt() and 0xff) shl 24))
        assertEquals(0, bytes[8].toInt() or bytes[9].toInt()) // method 0: stored
        assertEquals("header.json", String(bytes, 30, 11))
    }

    @Test fun `a folder snapshot lists its genomes but keeps them beside it`() {
        val s = buildSnapshot(loaded(), "test", embed = false)
        assertTrue(s.container.manifest.getBoolean("external_genomes"))
        assertEquals(2, s.files.size)
        assertTrue(s.container.genomes.isEmpty())
    }

    @Test fun `reads a v1 dump`() {
        val v1 = JSONObject()
            .put("format", "hearth-dump").put("version", 1).put("app_version", "x").put("exported_at", "2025-01-01T00:00:00.000Z")
            .put("persons", JSONArray().put(JSONObject().put("id", "p1").put("label", "a").put("displayName", "A").put("sex", "female").put("birthYear", 1970).put("notes", "").put("createdAt", "t")))
            .put("relationships", JSONArray())
            .put("source_files", JSONArray())
            .put("snp_index", JSONObject().put("rsids", JSONArray(listOf("rs1", "rs2"))).put("chromosomes", JSONArray(listOf("1", "2"))).put("positions", JSONArray(listOf(10, 20))))
            .put("genotypes", JSONObject().put("p1", "AG--"))
            .put("consents", JSONArray()).put("notes", JSONArray()).put("chats", JSONArray()).put("sharing_log", JSONArray())
        val repo = newRepo()
        val r = restoreBytes(repo, gzip(v1.toString().toByteArray()), null)
        assertEquals(1, r.persons)
        assertEquals(mapOf("p1" to 1), repo.genotypeCounts())
    }

    @Test fun `writes the fixture the web reads back`() {
        if (System.getenv("UPDATE_FIXTURES") == null) return
        File("../../fixtures/android.hearth").writeBytes(snapshotBytes(loaded(), "fixture"))
    }
}
