package com.hearth.data

import com.hearth.backup.openContainer
import com.hearth.backup.rebuildGenomesFromCache
import com.hearth.backup.restore
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the repair path of frontend/src/db/db.ts and export/restore.ts `rebuildGenomesFromCache`. */
class RepairTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource(name)!!.readBytes()

    private fun loaded(): Repo = Repo(JdbcSql(), Blobs(Files.createTempDirectory("blobs").toFile())).also { restore(it, openContainer(fixture("genomes.hearth"))) }

    private fun rows(sql: Sql, table: String) = sql.query("SELECT * FROM $table").map { it.toSortedMap(compareBy { k -> k }).toString() }.sorted()

    @Test fun `keeps every table but genotypes in a fresh database, and rebuilds the DNA from the genome files`() {
        val a = loaded()
        a.genotypeCounts() // caches the counts in meta, as the app does
        val fresh = JdbcSql()
        val s = salvage(a.sql)
        assertTrue("genotype" !in s.tables)
        assertEquals(emptyList<String>(), s.lost)
        val back = restoreSalvage(fresh, s)
        assertEquals(2, back["person"])
        assertEquals((a.sql.query("SELECT COUNT(*) AS n FROM health_log").first()["n"] as Number).toInt(), back["health_log"])
        for (t in listOf("person", "relationship", "source_file", "health_log", "consent", "note")) assertEquals(t, rows(a.sql, t), rows(fresh, t))
        // The device id and generation come back from the damaged file, not the new one; the cached counts do not.
        assertEquals(a.getMeta("device"), Repo(fresh, a.blobs).getMeta("device"))
        assertEquals(a.getMeta("generation"), Repo(fresh, a.blobs).getMeta("generation"))
        assertEquals(null, Repo(fresh, a.blobs).getMeta("genotype_counts"))

        val repaired = Repo(fresh, a.blobs)
        assertTrue(repaired.genotypeCounts().isEmpty())
        assertEquals(2, rebuildGenomesFromCache(repaired))
        assertEquals(a.genotypeCounts(), repaired.genotypeCounts())
        assertEquals(rows(a.sql, "genotype"), rows(fresh, "genotype"))
        // Nothing left to rebuild, and foreign keys are back on.
        assertEquals(0, rebuildGenomesFromCache(repaired))
        assertEquals(1, (fresh.query("PRAGMA foreign_keys").first()["foreign_keys"] as Number).toInt())
    }

    @Test fun `a table that fails keeps the rows read before the failure and is named`() {
        val a = loaded()
        val damaged = object : Sql by a.sql {
            override fun readInto(sql: String, out: MutableList<Row>) {
                if (sql.contains("\"health_log\"")) {
                    out.addAll(a.sql.query(sql).take(2))
                    throw IllegalStateException("database disk image is malformed")
                }
                out.addAll(a.sql.query(sql))
            }
        }
        val s = salvage(damaged)
        assertEquals(listOf("health_log"), s.lost)
        assertEquals(2, s.tables.getValue("health_log").size)
        assertEquals(2, s.tables.getValue("person").size)
        val fresh = JdbcSql()
        assertEquals(2, restoreSalvage(fresh, s)["health_log"])
    }

    @Test fun `an unreadable catalogue loses everything but says so`() {
        val broken = object : Sql by JdbcSql() {
            override fun query(sql: String, args: List<Any?>): List<Row> = throw IllegalStateException("database disk image is malformed")
        }
        val s = salvage(broken)
        assertEquals(listOf("sqlite_master"), s.lost)
        assertTrue(s.tables.isEmpty())
        assertFalse(restoreSalvage(JdbcSql(), s).isNotEmpty())
    }

    @Test fun `a row the new schema refuses stays behind without stopping the rest`() {
        val s = Salvage(
            mapOf("note" to listOf(mapOf("id" to "n1", "person_id" to "nobody", "topic" to "t", "markdown" to "m", "updated_at" to "x", "extra" to "ignored"), mapOf("id" to null))),
            emptyList(),
        )
        // The first row has a column the schema lacks (dropped), the second a NULL primary key's NOT NULL sibling; one lands, the loop goes on.
        val fresh = JdbcSql()
        val counts = restoreSalvage(fresh, s)
        assertTrue((counts["note"] ?: 0) <= 2)
    }
}
