package com.hearth.data

import android.content.Context
import android.database.Cursor
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * `user.db` in the app's private storage, with the web's schema (ADR 0010). Android's backup is
 * off for the whole app (allowBackup="false"), so this file never leaves the phone except as a
 * backup the user makes.
 */
class Db private constructor(private val appContext: Context) :
    // Android's default handler deletes a database file it finds damaged, health data and all. This
    // one leaves it where it is: the repair screen asks first, and keeps whatever can still be read.
    SQLiteOpenHelper(appContext, NAME, null, SCHEMA_VERSION, DatabaseErrorHandler { }), Sql {

    /** Called (on whatever thread hit it) when a statement finds the file damaged. */
    @Volatile var onCorrupt: ((String) -> Unit)? = null

    private inline fun <T> guard(block: () -> T): T = try {
        block()
    } catch (e: SQLiteException) {
        if (isCorrupt(e)) onCorrupt?.invoke(e.message ?: "database disk image is malformed")
        throw e
    }

    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) = Unit

    // Every table is created idempotently, as on the web: a new one lands on the next open. Then the
    // bookkeeping rows db.ts writes, so an export from here carries a schema version and a device id
    // like every other Hearth file.
    override fun onOpen(db: SQLiteDatabase) {
        if (db.isReadOnly) return
        schemaStatements().forEach(db::execSQL)
        // Additive column migrations, as db.ts runs them: CREATE TABLE IF NOT EXISTS leaves an
        // existing table as it was, so columns added since are added here; "duplicate column" is fine.
        for (col in PERSON_ADDED_COLUMNS) {
            try {
                db.execSQL("ALTER TABLE person ADD COLUMN $col")
            } catch (_: android.database.SQLException) {
            }
        }
        for (col in HEALTH_LOG_ADDED_COLUMNS) {
            try {
                db.execSQL("ALTER TABLE health_log ADD COLUMN $col")
            } catch (_: android.database.SQLException) {
            }
        }
        seedMeta().forEach { (k, v) -> db.execSQL("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", arrayOf(k, v)) }
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    override fun exec(sql: String, args: List<Any?>) = guard {
        writableDatabase.execSQL(sql, args.toTypedArray())
    }

    // rawQuery binds strings only. SQLite applies the column's affinity to a text argument
    // compared with a column, so `version=?` with "1" still matches an INTEGER 1.
    override fun query(sql: String, args: List<Any?>): List<Row> = buildList {
        readInto(sql, args, this)
    }

    // The rows are added as they are read, so a repair keeps those before the first bad page.
    private fun readInto(sql: String, args: List<Any?>, out: MutableList<Row>) = guard {
        readableDatabase.rawQuery(sql, args.map { it?.toString() }.toTypedArray()).use { c ->
            while (c.moveToNext()) out.add((0 until c.columnCount).associate { c.getColumnName(it) to c.value(it) })
        }
    }

    override fun readInto(sql: String, out: MutableList<Row>) = readInto(sql, emptyList(), out)

    override fun check(): Boolean {
        val ok = try {
            query("PRAGMA quick_check(1)").firstOrNull()?.values?.firstOrNull() == "ok"
        } catch (_: SQLiteException) {
            false // a damaged file can fail the check itself; guard has told onCorrupt already
        }
        if (!ok) onCorrupt?.invoke("database disk image is malformed")
        return ok
    }

    override fun <T> transaction(block: () -> T): T = guard {
        val db = writableDatabase
        db.beginTransaction()
        try {
            block().also { db.setTransactionSuccessful() }
        } finally {
            db.endTransaction()
        }
    }

    /**
     * Replaces a damaged database file with a fresh one holding everything that could still be read
     * ([salvage]); genotypes come back from the genome files kept beside it (rebuildGenomesFromCache).
     * Returns the rows each table got back, and the tables that could not be read in full.
     */
    fun repair(): Pair<Map<String, Int>, List<String>> {
        // The helper's connection goes first: it must not hold the file, and opening it through the
        // helper would run the schema and migrations into the damaged file before anything is read.
        runCatching { close() }
        val kept = runCatching {
            // Read-write, not read-only, so a hot journal can still roll back as the file opens.
            SQLiteDatabase.openDatabase(appContext.getDatabasePath(NAME).path, null, SQLiteDatabase.OPEN_READWRITE, DatabaseErrorHandler { })
                .use { salvage(RawSql(it)) }
        }.getOrElse { Salvage(emptyMap(), listOf("sqlite_master")) } // a file that will not even open gives nothing up
        appContext.deleteDatabase(NAME)
        // The first statement opens a new file: schema, migrations and the meta rows come with it.
        return restoreSalvage(this, kept) to kept.lost
    }

    override fun insertMany(sql: String, rows: List<List<Any?>>, onProgress: (Int) -> Unit) = guard {
        writableDatabase.compileStatement(sql).use { st ->
            rows.forEachIndexed { n, row ->
                st.clearBindings()
                row.forEachIndexed { i, v ->
                    when (v) {
                        null -> st.bindNull(i + 1)
                        is Long -> st.bindLong(i + 1, v)
                        is Int -> st.bindLong(i + 1, v.toLong())
                        is Double -> st.bindDouble(i + 1, v)
                        else -> st.bindString(i + 1, v.toString())
                    }
                }
                st.executeInsert()
                if ((n + 1) % 50_000 == 0) onProgress(n + 1)
            }
        }
    }

    companion object {
        private const val NAME = "user.db"

        /** SQLite's words for a damaged file: SQLITE_CORRUPT, and SQLITE_NOTADB ("file is not a database"). */
        fun isCorrupt(e: Throwable) =
            e is SQLiteDatabaseCorruptException || Regex("malformed|SQLITE_CORRUPT|SQLITE_NOTADB|not a database", RegexOption.IGNORE_CASE).containsMatchIn(e.message ?: "")

        @Volatile private var instance: Db? = null

        fun get(context: Context): Db =
            instance ?: synchronized(this) { instance ?: Db(context.applicationContext).also { instance = it } }
    }
}

/** Just the reading side of [Sql] over a bare database, which a repair opens without the helper's schema work. */
private class RawSql(private val db: SQLiteDatabase) : Sql {
    override fun exec(sql: String, args: List<Any?>) = db.execSQL(sql, args.toTypedArray())

    override fun query(sql: String, args: List<Any?>): List<Row> = buildList { read(sql, args, this) }

    override fun readInto(sql: String, out: MutableList<Row>) = read(sql, emptyList(), out)

    private fun read(sql: String, args: List<Any?>, out: MutableList<Row>) {
        db.rawQuery(sql, args.map { it?.toString() }.toTypedArray()).use { c ->
            while (c.moveToNext()) {
                out.add((0 until c.columnCount).associate { c.getColumnName(it) to c.value(it) })
            }
        }
    }

    override fun <T> transaction(block: () -> T): T = block()

    override fun insertMany(sql: String, rows: List<List<Any?>>, onProgress: (Int) -> Unit) =
        throw UnsupportedOperationException("a repair only reads")
}

private fun Cursor.value(i: Int): Any? = when (getType(i)) {
    Cursor.FIELD_TYPE_NULL -> null
    Cursor.FIELD_TYPE_INTEGER -> getLong(i)
    Cursor.FIELD_TYPE_FLOAT -> getDouble(i)
    Cursor.FIELD_TYPE_BLOB -> getBlob(i)
    else -> getString(i)
}
