package com.hearth.data

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class SchemaTest {
    @Test fun `schema is the web schema, verbatim`() {
        // Gradle runs unit tests from the module directory, mobile/android/app.
        val ts = File("../../../frontend/src/db/schema.ts").readText()
        val web = Regex("SCHEMA_SQL = `(.*?)`", RegexOption.DOT_MATCHES_ALL).find(ts)!!.groupValues[1]
        assertEquals(web, SCHEMA_SQL)
        assertEquals(Regex("SCHEMA_VERSION = (\\d+)").find(ts)!!.groupValues[1].toInt(), SCHEMA_VERSION)
    }

    @Test fun `splits into statements that all run`() {
        JdbcSql() // creating it runs every statement
        assertEquals(14, schemaStatements().size)
    }
}
