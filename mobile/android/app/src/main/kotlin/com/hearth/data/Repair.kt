package com.hearth.data

/**
 * Salvaging a damaged database (db.worker.ts `repair` and db.ts `Database.repair`): read what can
 * still be read, table by table and row by row, start a clean file, and put the rows back. Pure
 * over [Sql], so it runs against a JDBC SQLite in tests; [Db.repair] does the file work around it.
 *
 * Genotypes are left out: rows cut short there would pass for a whole genome, and the original
 * files kept beside the database (or a backup) rebuild them.
 */
class Salvage(val tables: Map<String, List<Row>>, val lost: List<String>)

private fun quoted(name: String) = "\"${name.replace("\"", "\"\"")}\""

/** Every readable row of every table but genotypes. A table that fails keeps the rows read before it did, and is named in `lost`. */
fun salvage(sql: Sql): Salvage {
    val tables = LinkedHashMap<String, List<Row>>()
    val lost = mutableListOf<String>()
    val names = try {
        sql.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map { it.str("name") }
    } catch (_: Exception) {
        lost.add("sqlite_master")
        emptyList()
    }
    for (name in names) {
        if (name == "genotype") continue
        val rows = mutableListOf<Row>()
        try {
            sql.readInto("SELECT * FROM ${quoted(name)}", rows)
        } catch (_: Exception) {
            lost.add(name)
        }
        tables[name] = rows
    }
    return Salvage(tables, lost)
}

/**
 * Inserts the salvaged rows into the fresh, schema-complete database [sql], by column name (a
 * column the new schema lacks is dropped), with foreign keys off, since an orphan row is better
 * kept than lost here. Returns how many rows each table got back.
 */
fun restoreSalvage(sql: Sql, s: Salvage): Map<String, Int> {
    val counts = LinkedHashMap<String, Int>()
    sql.exec("PRAGMA foreign_keys = OFF")
    try {
        for ((table, list) in s.tables) {
            val have = sql.query("PRAGMA table_info(${quoted(table)})").map { it.str("name") }.toSet()
            if (have.isEmpty()) continue
            // Cached counts would describe the genotypes that are gone.
            val keep = if (table == "meta") list.filter { it["key"] != "genotype_counts" } else list
            // Meta first written by the fresh database (device, generation) gives way to the old values.
            val verb = if (table == "meta") "INSERT OR REPLACE" else "INSERT OR IGNORE"
            var n = 0
            sql.transaction {
                for (r in keep) {
                    val cols = r.keys.filter { it in have }
                    if (cols.isEmpty()) continue
                    try {
                        sql.exec("$verb INTO ${quoted(table)}(${cols.joinToString(",") { quoted(it) }}) VALUES (${cols.joinToString(",") { "?" }})", cols.map { r[it] })
                        n++
                    } catch (_: Exception) {
                        // a row the new schema refuses (a constraint): it stays behind
                    }
                }
            }
            counts[table] = n
        }
    } finally {
        sql.exec("PRAGMA foreign_keys = ON")
    }
    return counts
}
