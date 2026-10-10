import Foundation
import SQLite3

/// One value in or out of SQLite. Only the four storage classes the schema uses: nothing Hearth
/// stores is a BLOB (attachment bytes live beside the database, ADR 0001).
enum SQLValue: Equatable {
    case null
    case integer(Int64)
    case real(Double)
    case text(String)
}

/// One result row, keyed by column name.
typealias Row = [String: SQLValue]

extension Dictionary where Key == String, Value == SQLValue {
    func text(_ column: String) -> String {
        if case .text(let s)? = self[column] { return s }
        return ""
    }

    func int(_ column: String) -> Int? {
        switch self[column] {
        case .integer(let n)?: return Int(n)
        // A REAL in an INTEGER column only happens in a hand-edited database; round-trip it rather
        // than hide the value.
        case .real(let d)? where d.rounded() == d && abs(d) < 1e15: return Int(d)
        default: return nil
        }
    }

    func double(_ column: String) -> Double? {
        switch self[column] {
        case .integer(let n)?: return Double(n)
        case .real(let d)?: return d
        default: return nil
        }
    }
}

struct DbError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// SQLite's SQLITE_TRANSIENT, which the C header defines as a cast Swift does not import: the
/// library copies bound text before the call returns, so a Swift string's temporary buffer is safe.
private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// `user.db` through the system `libsqlite3` (ADR 0010): the web app's schema, verbatim, with
/// foreign keys on, so deleting an entry takes its attachment rows with it exactly as it does there.
///
/// Every statement is prepared and every value bound; nothing is ever spliced into SQL text except
/// table and column names that are constants in the calling code.
///
/// One connection, used from any thread one caller at a time: every call takes a recursive lock,
/// and a transaction holds it from BEGIN to COMMIT. The slow work (a genome import, a restore that
/// loads genomes) runs on a background queue behind a sheet the user cannot dismiss, so the main
/// thread never waits on it in practice; if it did, it would wait rather than interleave.
final class Db {
    private let handle: OpaquePointer
    private let lock = NSRecursiveLock()
    /// How many `transaction` calls are open on this connection. Only the outermost begins, commits
    /// or rolls back; an inner one that throws marks the whole transaction failed.
    private var depth = 0
    private var innerFailed = false

    /// Called after every write that changed user data (db.ts `onChange`), on the writing thread
    /// and inside the database's lock: the backup schedules itself on it, and must only enqueue.
    var onChange: (() -> Void)?

    /// Called (on whatever thread hit it) when a statement finds the file damaged (SQLITE_CORRUPT).
    var onCorrupt: ((String) -> Void)?

    private var closed = false

    /// SQLite's words for a damaged file: SQLITE_CORRUPT ("database disk image is malformed") and
    /// SQLITE_NOTADB ("file is not a database").
    static func isCorrupt(_ message: String) -> Bool {
        message.range(of: "malformed|SQLITE_CORRUPT|SQLITE_NOTADB|not a database", options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func isCorrupt(_ error: Error) -> Bool {
        isCorrupt((error as? DbError)?.message ?? error.localizedDescription)
    }

    /// Opens (creating if needed) the database at `path`; `":memory:"` gives a private in-memory one.
    /// With `prepare` off the schema and migrations are skipped, which is how a damaged file is
    /// opened to read what it still holds (`repair(path:)`).
    init(path: String, prepare: Bool = true) throws {
        var opened: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE
        let rc = sqlite3_open_v2(path, &opened, flags, nil)
        guard rc == SQLITE_OK, let db = opened else {
            let message = opened.map { String(cString: sqlite3_errmsg($0)) } ?? "cannot open the database"
            sqlite3_close(opened)
            throw DbError(message: message)
        }
        handle = db
        try execScript("PRAGMA foreign_keys = ON")
        guard prepare else { return }
        try execScript(SCHEMA_SQL)
        // Additive column migrations, as db.ts runs them: an existing table keeps its old columns
        // under CREATE TABLE IF NOT EXISTS, so later ones are added here ("duplicate column" is fine).
        for col in PERSON_ADDED_COLUMNS {
            try? execScript("ALTER TABLE person ADD COLUMN \(col)")
        }
        for col in HEALTH_LOG_ADDED_COLUMNS {
            try? execScript("ALTER TABLE health_log ADD COLUMN \(col)")
        }
        // The same bookkeeping rows db.ts writes, so a later export from this database carries a
        // schema version and a device id like every other Hearth file.
        try run("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", [.text("schema_version"), .text("1")])
        try run("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", [.text("device"), .text(newId())])
        try run("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", [.text("generation"), .text("0")])
    }

    deinit {
        close()
    }

    /// Closes the connection now; further use is a programming error. Idempotent.
    func close() {
        lock.lock()
        defer { lock.unlock() }
        if !closed { sqlite3_close(handle) }
        closed = true
    }

    /// The app's own database: `user.db` in Application Support, kept out of iCloud and iTunes
    /// backups. A phone backup would otherwise copy the family's health records to Apple's servers
    /// without the user choosing it, which is what Android's `allowBackup=false` prevents too; the
    /// user's own backup is the Hearth file, which they place themselves.
    static func openDefault() throws -> Db {
        var file = try defaultFile()
        let db = try Db(path: file.path)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try file.setResourceValues(values)
        return db
    }

    /// Where the app's database lives (and where a repair puts the new one).
    static func defaultFile() throws -> URL {
        try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ).appendingPathComponent("user.db")
    }

    /// Runs SQL text with no parameters, possibly several statements (the schema).
    func execScript(_ sql: String) throws {
        lock.lock()
        defer { lock.unlock() }
        var error: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(handle, sql, nil, nil, &error)
        if rc != SQLITE_OK {
            let message = error.map { String(cString: $0) } ?? lastError
            sqlite3_free(error)
            throw failure(message)
        }
    }

    /// Runs one statement; returns how many rows it changed. A write that changed user data also
    /// bumps meta.generation, and one that can change how many genotypes someone has drops the
    /// cached counts, as the web's worker does, so no code path can forget either.
    @discardableResult
    func run(_ sql: String, _ params: [SQLValue] = []) throws -> Int {
        lock.lock()
        defer { lock.unlock() }
        let changed = try step(sql, params)
        if changed > 0 { try afterWrite(sql) }
        return changed
    }

    /// Runs one prepared statement for each of `count` rows, compiled once and inside one
    /// transaction (joining the caller's if there is one): the genome import's hundreds of
    /// thousands of rows. `row(i)` gives the i-th row's parameters; `onProgress` gets the count
    /// done every 50 000 rows, on the calling thread. The generation and the counts cache are
    /// touched once at the end, not per row.
    func insertMany(
        _ sql: String, count: Int, onProgress: ((Int) -> Void)? = nil, row: (Int) -> [SQLValue]
    ) throws {
        lock.lock()
        defer { lock.unlock() }
        try transaction {
            let statement = try prepare(sql)
            defer { sqlite3_finalize(statement) }
            for i in 0..<count {
                try bind(statement, row(i))
                guard sqlite3_step(statement) == SQLITE_DONE else { throw failure(lastError) }
                sqlite3_reset(statement)
                if (i + 1) % 50_000 == 0 { onProgress?(i + 1) }
            }
            if count > 0 { try afterWrite(sql) }
        }
    }

    /// The worker's bookkeeping after a write that changed rows.
    private func afterWrite(_ sql: String) throws {
        guard Db.isWrite(sql) else { return }
        try step(Db.bump, [])
        if Db.touchesGenotypes(sql) { try step(Db.dropGenotypeCounts, []) }
        onChange?()
    }

    private func step(_ sql: String, _ params: [SQLValue]) throws -> Int {
        let statement = try prepare(sql, params)
        defer { sqlite3_finalize(statement) }
        let rc = sqlite3_step(statement)
        guard rc == SQLITE_DONE || rc == SQLITE_ROW else { throw failure(lastError) }
        return Int(sqlite3_changes(handle))
    }

    /// The worker's rule (`db.worker.ts` `isWrite`): INSERT, UPDATE, DELETE or REPLACE that does not
    /// name the meta table.
    static func isWrite(_ sql: String) -> Bool {
        let s = sql.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let verb = ["INSERT", "UPDATE", "DELETE", "REPLACE"].contains { s.hasPrefix($0) }
        return verb && s.range(of: #"\bMETA\b"#, options: .regularExpression) == nil
    }

    /// The worker's `touchesGenotypes`: a write naming the genotype table, or deleting a person
    /// (their rows cascade), can change how many genotypes someone has.
    static func touchesGenotypes(_ sql: String) -> Bool {
        guard isWrite(sql) else { return false }
        let s = sql.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return s.range(of: #"\bGENOTYPE\b"#, options: .regularExpression) != nil
            || s.range(of: #"^DELETE\s+FROM\s+PERSON\b"#, options: .regularExpression) != nil
    }

    private static let dropGenotypeCounts = "DELETE FROM meta WHERE key = 'genotype_counts'"

    private static let bump =
        "INSERT INTO meta(key, value) VALUES ('generation', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"

    /// Runs one query and returns every row.
    func query(_ sql: String, _ params: [SQLValue] = []) throws -> [Row] {
        lock.lock()
        defer { lock.unlock() }
        let statement = try prepare(sql, params)
        defer { sqlite3_finalize(statement) }
        var rows: [Row] = []
        while true {
            let rc = sqlite3_step(statement)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw failure(lastError) }
            var row: Row = [:]
            for i in 0..<sqlite3_column_count(statement) {
                row[String(cString: sqlite3_column_name(statement, i))] = column(statement, i)
            }
            rows.append(row)
        }
        return rows
    }

    /// `body` inside one transaction: all of it lands or none of it does. A restore that fails half
    /// way must leave the database as it was, not half merged.
    ///
    /// Re-entrant, like Android's: a transaction opened inside another joins it (SQLite has no
    /// nested BEGIN). Only the outermost commits, and it rolls back instead when any inner one
    /// threw, even if the caller caught that error.
    @discardableResult
    func transaction<T>(_ body: () throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        if depth > 0 {
            depth += 1
            defer { depth -= 1 }
            do {
                return try body()
            } catch {
                innerFailed = true
                throw error
            }
        }
        try execScript("BEGIN IMMEDIATE")
        depth = 1
        innerFailed = false
        defer {
            depth = 0
            innerFailed = false
        }
        do {
            let result = try body()
            if innerFailed { throw DbError(message: "a nested transaction failed") }
            try execScript("COMMIT")
            return result
        } catch {
            try? execScript("ROLLBACK")
            throw error
        }
    }

    private var lastError: String { String(cString: sqlite3_errmsg(handle)) }

    /// The error to throw for a failed statement; damage also tells `onCorrupt`, so the app can put
    /// the repair screen up wherever the statement came from.
    private func failure(_ message: String) -> DbError {
        if Db.isCorrupt(message) { onCorrupt?(message) }
        return DbError(message: message)
    }

    private func prepare(_ sql: String, _ params: [SQLValue]) throws -> OpaquePointer {
        let statement = try prepare(sql)
        do {
            try bind(statement, params)
        } catch {
            sqlite3_finalize(statement)
            throw error
        }
        return statement
    }

    private func prepare(_ sql: String) throws -> OpaquePointer {
        var prepared: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &prepared, nil) == SQLITE_OK, let statement = prepared else {
            throw failure(lastError)
        }
        return statement
    }

    /// Binds every parameter, replacing whatever the statement held before (`insertMany` rebinds
    /// the same statement per row, and every row has every column).
    private func bind(_ statement: OpaquePointer, _ params: [SQLValue]) throws {
        for (offset, value) in params.enumerated() {
            let index = Int32(offset + 1)
            let rc: Int32
            switch value {
            case .null: rc = sqlite3_bind_null(statement, index)
            case .integer(let n): rc = sqlite3_bind_int64(statement, index, n)
            case .real(let d): rc = sqlite3_bind_double(statement, index, d)
            case .text(let s): rc = sqlite3_bind_text(statement, index, s, -1, transient)
            }
            if rc != SQLITE_OK { throw failure(lastError) }
        }
    }

    private func column(_ statement: OpaquePointer, _ i: Int32) -> SQLValue {
        switch sqlite3_column_type(statement, i) {
        case SQLITE_INTEGER:
            return .integer(sqlite3_column_int64(statement, i))
        case SQLITE_FLOAT:
            return .real(sqlite3_column_double(statement, i))
        case SQLITE_NULL:
            return .null
        default:
            // TEXT (and a BLOB, which nothing writes): read with its length, not up to a NUL.
            guard let bytes = sqlite3_column_text(statement, i) else { return .null }
            let count = Int(sqlite3_column_bytes(statement, i))
            return .text(String(decoding: UnsafeBufferPointer(start: bytes, count: count), as: UTF8.self))
        }
    }
}

/// A random id in the form `crypto.randomUUID()` gives the web app: lower-case, hyphenated.
func newId() -> String {
    UUID().uuidString.lowercased()
}

/// Now as ISO 8601 UTC with milliseconds (`2026-09-21T10:00:00.000Z`), as `new Date().toISOString()`.
func nowISO() -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: Date())
}

// MARK: - Repair

/// What can still be read from a damaged database (db.worker.ts `repair`): every table but
/// genotypes, row by row. Genotypes are left out: rows cut short there would pass for a whole
/// genome, and the original files kept beside the database (or a backup) rebuild them.
struct Salvage {
    var tables: [(name: String, rows: [Row])] = []
    /// Tables that could not be read in full (the rows before the first bad page are kept).
    var lost: [String] = []
}

/// What a repair kept: the rows each table got back, and the tables that could not be read in full.
struct Repaired {
    let rows: [String: Int]
    let lost: [String]
}

private func quoted(_ name: String) -> String {
    "\"" + name.replacingOccurrences(of: "\"", with: "\"\"") + "\""
}

extension Db {
    /// Like `query`, but the rows read before an error stay in `rows`: a damaged table gives up the
    /// rows before its first bad page.
    func readInto(_ sql: String, rows: inout [Row]) throws {
        lock.lock()
        defer { lock.unlock() }
        let statement = try prepare(sql, [])
        defer { sqlite3_finalize(statement) }
        while true {
            let rc = sqlite3_step(statement)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw failure(lastError) }
            var row: Row = [:]
            for i in 0..<sqlite3_column_count(statement) {
                row[String(cString: sqlite3_column_name(statement, i))] = column(statement, i)
            }
            rows.append(row)
        }
    }

    /// Every readable row of every table but genotypes.
    func salvage() -> Salvage {
        var out = Salvage()
        let names: [String]
        do {
            names = try query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map { $0.text("name") }
        } catch {
            out.lost.append("sqlite_master")
            return out
        }
        for name in names where name != "genotype" {
            var rows: [Row] = []
            do {
                try readInto("SELECT * FROM \(quoted(name))", rows: &rows)
            } catch {
                out.lost.append(name)
            }
            out.tables.append((name, rows))
        }
        return out
    }

    /// Inserts the salvaged rows into this fresh, schema-complete database, by column name (a column
    /// the new schema lacks is dropped), with foreign keys off, since an orphan row is better kept
    /// than lost here. Straight to the statement: these are not changes the user made, so no
    /// generation bump. Returns how many rows each table got back.
    func restore(_ s: Salvage) throws -> [String: Int] {
        var counts: [String: Int] = [:]
        try execScript("PRAGMA foreign_keys = OFF")
        defer { try? execScript("PRAGMA foreign_keys = ON") }
        for (table, list) in s.tables {
            let have = Set(try query("PRAGMA table_info(\(quoted(table)))").map { $0.text("name") })
            if have.isEmpty { continue }
            // Cached counts would describe the genotypes that are gone.
            let keep = table == "meta" ? list.filter { $0.text("key") != "genotype_counts" } : list
            // Meta first written by the fresh database (device, generation) gives way to the old values.
            let verb = table == "meta" ? "INSERT OR REPLACE" : "INSERT OR IGNORE"
            var n = 0
            try transaction {
                for r in keep {
                    let cols = r.keys.filter { have.contains($0) }.sorted()
                    if cols.isEmpty { continue }
                    let sql = "\(verb) INTO \(quoted(table))(\(cols.map(quoted).joined(separator: ","))) VALUES (\(cols.map { _ in "?" }.joined(separator: ",")))"
                    // A row the new schema refuses (a constraint) stays behind.
                    if (try? step(sql, cols.map { r[$0] ?? .null })) != nil { n += 1 }
                }
            }
            counts[table] = n
        }
        return counts
    }

    /// Replaces a damaged database file with a fresh one holding everything that could still be
    /// read. Genotypes come back from the genome files kept beside it (`Restore.rebuildGenomesFromCache`).
    /// Works on the file, so it serves a database that would not open and one that failed mid-session.
    static func repair(path: String) throws -> Repaired {
        let kept: Salvage
        do {
            let damaged = try Db(path: path, prepare: false)
            kept = damaged.salvage()
            // Closed before the files go, so nothing holds the old inode or its journal.
            damaged.close()
        }
        let fm = FileManager.default
        for suffix in ["", "-journal", "-wal", "-shm"] { try? fm.removeItem(atPath: path + suffix) }
        let fresh = try Db(path: path)
        let rows = try fresh.restore(kept)
        fresh.close()
        return Repaired(rows: rows, lost: kept.lost)
    }

    /// SQLite's quick_check over the whole file (db.ts `check`): damage in pages no query reads (an
    /// index, a far corner of the genotype table) raises no error until something does; this finds
    /// it. Damage also tells `onCorrupt`, which puts the repair screen up.
    func check() -> Bool {
        let ok: Bool
        do {
            ok = try query("PRAGMA quick_check(1)").first?["quick_check"] == SQLValue.text("ok")
        } catch {
            return false // a damaged file can fail the check itself; `failure` has told onCorrupt already
        }
        if !ok { onCorrupt?("database disk image is malformed") }
        return ok
    }
}
