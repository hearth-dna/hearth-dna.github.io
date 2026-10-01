package com.hearth.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RepoTest {
    private val sql = JdbcSql().apply {
        exec("INSERT INTO person(id,label,display_name,sex,created_at) VALUES ('p','p','P','unknown','2026-01-01T00:00:00.000Z')")
    }
    private val repo = Repo(sql, Blobs(java.nio.file.Files.createTempDirectory("blobs").toFile()))
    private fun generation() = sql.query("SELECT value FROM meta WHERE key='generation'").firstOrNull()?.get("value")

    @Test fun `stores entries the way the web does`() {
        val e = repo.addHealthEntry(
            NewHealthEntry("p", "2026-09-14", "8:05", HealthKind.MEASUREMENT, "Blood pressure", "", "", null, listOf("bp", "home"), 120.0, 80.0, "mmHg"),
        )
        assertTrue(Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").matches(e.id))
        assertTrue(Regex("""^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$""").matches(e.createdAt))
        val row = sql.query("SELECT * FROM health_log").single()
        assertEquals("08:05", row["time"])
        assertEquals("bp, home", row["tags"])
        assertEquals(listOf(e), repo.listHealthLog())
        assertEquals("1", generation())
        repo.deleteHealthEntry(e.id)
        assertEquals(emptyList<HealthEntry>(), repo.listHealthLog())
        assertEquals("2", generation())
    }

    @Test fun `normalises body part, unit and tags as the web does`() {
        val e = repo.addHealthEntry(
            NewHealthEntry("p", "2026-09-14", "", HealthKind.SYMPTOM, "Cough", "", " Lungs ", 3, listOf("Cold", "cold "), null, null, " mg "),
        )
        val row = sql.query("SELECT * FROM health_log").single()
        assertEquals("lungs", row["body_part"])
        assertEquals("mg", row["unit"])
        assertEquals("cold", row["tags"])
        assertEquals(listOf("cold"), e.tags)
    }

    @Test fun `a new database has a schema version, a device id and generation 0`() {
        val meta = JdbcSql().query("SELECT key, value FROM meta").associate { it["key"] to it["value"] }
        assertEquals("1", meta["schema_version"])
        assertEquals("0", meta["generation"])
        assertTrue(Regex("^[0-9a-f-]{36}$").matches(meta["device"] as String))
    }

    @Test fun `a failed transaction leaves nothing behind`() {
        runCatching {
            sql.transaction {
                sql.exec("INSERT INTO person(id,label,display_name,sex,created_at) VALUES ('q','q','Q','unknown','2026-01-01T00:00:00.000Z')")
                error("boom")
            }
        }
        assertEquals(1, sql.query("SELECT * FROM person").size)
    }

    @Test fun `only a write that changed rows bumps the generation`() {
        val q = repo.addPerson("q", "Q", Sex.UNKNOWN, null)
        val g = generation()
        repo.setParent("p", q.id)
        assertEquals((g!!.toString().toInt() + 1).toString(), generation())
        repo.setParent("p", q.id) // already there
        repo.deleteHealthEntry("nothing-by-this-id")
        repo.grantConsent(ConsentKind.FIRST_LAUNCH)
        repo.grantConsent(ConsentKind.FIRST_LAUNCH)
        assertEquals((g.toString().toInt() + 2).toString(), generation())
    }

    @Test fun `consent recreates a missing generation counter and increments it on later writes`() {
        sql.exec("DELETE FROM meta WHERE key='generation'")
        repo.grantConsent(ConsentKind.FIRST_LAUNCH)
        assertTrue(repo.hasConsent(ConsentKind.FIRST_LAUNCH))
        assertEquals("1", generation())
        repo.grantConsent(ConsentKind.FIRST_LAUNCH)
        assertEquals("1", generation())
        repo.grantConsent(ConsentKind.IMPORT_DOCUMENT, "p")
        assertEquals("2", generation())
    }

    @Test fun `records a consent once, at the current version`() {
        assertFalse(repo.hasConsent(ConsentKind.IMPORT_DOCUMENT, "p"))
        repo.grantConsent(ConsentKind.IMPORT_DOCUMENT, "p")
        repo.grantConsent(ConsentKind.IMPORT_DOCUMENT, "p")
        assertTrue(repo.hasConsent(ConsentKind.IMPORT_DOCUMENT, "p"))
        assertFalse(repo.hasConsent(ConsentKind.IMPORT_DOCUMENT, "q"))
        assertEquals(1, sql.query("SELECT * FROM consent").size)
    }
}
