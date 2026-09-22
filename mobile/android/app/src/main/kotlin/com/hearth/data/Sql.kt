package com.hearth.data

/** A result row: column name to Long, Double, String, ByteArray or null. */
typealias Row = Map<String, Any?>

/**
 * The little of SQLite the repository and the restore need, so both run unchanged against the
 * framework database on a phone ([Db]) and against a JDBC SQLite in JVM tests.
 */
interface Sql {
    fun exec(sql: String, args: List<Any?> = emptyList())
    fun query(sql: String, args: List<Any?> = emptyList()): List<Row>
    fun <T> transaction(block: () -> T): T
}

fun Row.str(key: String): String = this[key] as? String ?: ""
fun Row.strOrNull(key: String): String? = this[key] as? String
fun Row.long(key: String): Long? = (this[key] as? Number)?.toLong()
fun Row.double(key: String): Double? = (this[key] as? Number)?.toDouble()
