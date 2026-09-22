package com.hearth.data

import java.sql.Connection
import java.sql.DriverManager

/** [Sql] over an in-memory JDBC SQLite, with the app's schema, for JVM tests. */
class JdbcSql : Sql {
    private val c: Connection = DriverManager.getConnection("jdbc:sqlite::memory:").apply {
        createStatement().use { it.execute("PRAGMA foreign_keys = ON") }
        schemaStatements().forEach { s -> createStatement().use { it.execute(s) } }
    }

    init {
        seedMeta().forEach { (k, v) -> exec("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", listOf(k, v)) }
    }

    override fun exec(sql: String, args: List<Any?>) {
        c.prepareStatement(sql).use { st ->
            args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
            st.execute()
        }
    }

    override fun query(sql: String, args: List<Any?>): List<Row> = c.prepareStatement(sql).use { st ->
        args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
        st.executeQuery().use { rs ->
            val md = rs.metaData
            buildList {
                while (rs.next()) add((1..md.columnCount).associate { md.getColumnLabel(it) to rs.getObject(it) })
            }
        }
    }

    /** Real BEGIN/COMMIT/ROLLBACK, so a test sees a failed restore leave nothing behind. */
    override fun <T> transaction(block: () -> T): T {
        c.autoCommit = false
        try {
            return block().also { c.commit() }
        } catch (e: Throwable) {
            c.rollback()
            throw e
        } finally {
            c.autoCommit = true
        }
    }
}
