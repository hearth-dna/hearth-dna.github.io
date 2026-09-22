package com.hearth.data

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * `user.db` in the app's private storage: the native app's own database (ADR 0010), with the web
 * schema. It is not the web view's database; a backup moves data between the two. Android's
 * backup is off for the whole app (allowBackup="false"), so this file never leaves the phone
 * except as a backup the user makes.
 */
class Db private constructor(context: Context) :
    SQLiteOpenHelper(context, "user.db", null, SCHEMA_VERSION), Sql {

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
        seedMeta().forEach { (k, v) -> db.execSQL("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", arrayOf(k, v)) }
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    override fun exec(sql: String, args: List<Any?>) {
        writableDatabase.execSQL(sql, args.toTypedArray())
    }

    // rawQuery binds strings only. SQLite applies the column's affinity to a text argument
    // compared with a column, so `version=?` with "1" still matches an INTEGER 1.
    override fun query(sql: String, args: List<Any?>): List<Row> =
        readableDatabase.rawQuery(sql, args.map { it?.toString() }.toTypedArray()).use { c ->
            buildList {
                while (c.moveToNext()) add((0 until c.columnCount).associate { c.getColumnName(it) to c.value(it) })
            }
        }

    override fun <T> transaction(block: () -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        try {
            return block().also { db.setTransactionSuccessful() }
        } finally {
            db.endTransaction()
        }
    }

    private fun Cursor.value(i: Int): Any? = when (getType(i)) {
        Cursor.FIELD_TYPE_NULL -> null
        Cursor.FIELD_TYPE_INTEGER -> getLong(i)
        Cursor.FIELD_TYPE_FLOAT -> getDouble(i)
        Cursor.FIELD_TYPE_BLOB -> getBlob(i)
        else -> getString(i)
    }

    companion object {
        @Volatile private var instance: Db? = null

        fun get(context: Context): Db =
            instance ?: synchronized(this) { instance ?: Db(context.applicationContext).also { instance = it } }
    }
}
