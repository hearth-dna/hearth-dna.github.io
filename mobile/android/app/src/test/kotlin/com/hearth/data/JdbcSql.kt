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

    override fun insertMany(sql: String, rows: List<List<Any?>>, onProgress: (Int) -> Unit) {
        c.prepareStatement(sql).use { st ->
            rows.forEachIndexed { n, row ->
                row.forEachIndexed { i, a -> st.setObject(i + 1, a) }
                st.addBatch()
                if ((n + 1) % 50_000 == 0) { st.executeBatch(); onProgress(n + 1) }
            }
            st.executeBatch()
        }
    }

    private var depth = 0

    /** Real BEGIN/COMMIT/ROLLBACK, nesting like Android's: only the outermost one commits. */
    override fun <T> transaction(block: () -> T): T {
        if (depth++ == 0) c.autoCommit = false
        try {
            return block().also { if (depth == 1) c.commit() }
        } catch (e: Throwable) {
            if (depth == 1) c.rollback()
            throw e
        } finally {
            if (--depth == 0) c.autoCommit = true
        }
    }
}
