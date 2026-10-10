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

    /**
     * Like [query], but the rows read before an error stay in [out]: a damaged table gives up the
     * rows before its first bad page (a repair keeps what it can). The default reads all or nothing.
     */
    fun readInto(sql: String, out: MutableList<Row>) {
        out.addAll(query(sql))
    }

    /**
     * SQLite's quick_check over the whole file (db.ts `check`): damage in pages no query reads (an
     * index, a far corner of the genotype table) raises no error until something does; this finds
     * it. On the phone, damage also puts the repair screen up.
     */
    fun check(): Boolean = query("PRAGMA quick_check(1)").firstOrNull()?.values?.firstOrNull() == "ok"
}

fun Row.str(key: String): String = this[key] as? String ?: ""
fun Row.strOrNull(key: String): String? = this[key] as? String
fun Row.long(key: String): Long? = (this[key] as? Number)?.toLong()
fun Row.double(key: String): Double? = (this[key] as? Number)?.toDouble()
