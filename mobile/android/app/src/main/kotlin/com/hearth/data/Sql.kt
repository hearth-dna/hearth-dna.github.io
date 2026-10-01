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

    /**
     * Runs one prepared INSERT for every row, inside the caller's transaction: the genome import's
     * hundreds of thousands of rows, compiled once. [onProgress] gets the count done every 50 000.
     */
    fun insertMany(sql: String, rows: List<List<Any?>>, onProgress: (Int) -> Unit = {})
}

fun Row.str(key: String): String = this[key] as? String ?: ""
fun Row.strOrNull(key: String): String? = this[key] as? String
fun Row.long(key: String): Long? = (this[key] as? Number)?.toLong()
fun Row.double(key: String): Double? = (this[key] as? Number)?.toDouble()
