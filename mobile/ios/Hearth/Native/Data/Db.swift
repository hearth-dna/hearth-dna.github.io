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
/// Not thread-safe by design: the app uses it from the main thread only, and the one slow step of a
/// restore (the key derivation) happens before the database is touched.
final class Db {
    private let handle: OpaquePointer

    /// Opens (creating if needed) the database at `path`; `":memory:"` gives a private in-memory one.
    init(path: String) throws {
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
        try execScript(SCHEMA_SQL)
        // The same bookkeeping rows db.ts writes, so a later export from this database carries a
        // schema version and a device id like every other Hearth file.
        try run("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", [.text("schema_version"), .text("1")])
        try run("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", [.text("device"), .text(newId())])
        try run("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", [.text("generation"), .text("0")])
    }

    deinit {
        sqlite3_close(handle)
    }

    /// The app's own database: `user.db` in Application Support, kept out of iCloud and iTunes
    /// backups. A phone backup would otherwise copy the family's health records to Apple's servers
    /// without the user choosing it, which is what Android's `allowBackup=false` prevents too; the
    /// user's own backup is the Hearth file, which they place themselves.
    static func openDefault() throws -> Db {
        let folder = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        var file = folder.appendingPathComponent("user.db")
        let db = try Db(path: file.path)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try file.setResourceValues(values)
        return db
    }

    /// Runs SQL text with no parameters, possibly several statements (the schema).
    func execScript(_ sql: String) throws {
        var error: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(handle, sql, nil, nil, &error)
        if rc != SQLITE_OK {
            let message = error.map { String(cString: $0) } ?? lastError
            sqlite3_free(error)
            throw DbError(message: message)
        }
    }

    /// Runs one statement; returns how many rows it changed. A write to user data also bumps
    /// meta.generation, as the web's worker does, so no code path can forget it.
    @discardableResult
    func run(_ sql: String, _ params: [SQLValue] = []) throws -> Int {
        let changed = try step(sql, params)
        if Db.isWrite(sql) { try step(Db.bump, []) }
        return changed
    }

    private func step(_ sql: String, _ params: [SQLValue]) throws -> Int {
        let statement = try prepare(sql, params)
        defer { sqlite3_finalize(statement) }
        let rc = sqlite3_step(statement)
        guard rc == SQLITE_DONE || rc == SQLITE_ROW else { throw DbError(message: lastError) }
        return Int(sqlite3_changes(handle))
    }

    /// The worker's rule (`db.worker.ts` `isWrite`): INSERT, UPDATE, DELETE or REPLACE that does not
    /// name the meta table.
    static func isWrite(_ sql: String) -> Bool {
        let s = sql.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let verb = ["INSERT", "UPDATE", "DELETE", "REPLACE"].contains { s.hasPrefix($0) }
        return verb && s.range(of: #"\bMETA\b"#, options: .regularExpression) == nil
    }

    private static let bump =
        "INSERT INTO meta(key, value) VALUES ('generation', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"

    /// Runs one query and returns every row.
    func query(_ sql: String, _ params: [SQLValue] = []) throws -> [Row] {
        let statement = try prepare(sql, params)
        defer { sqlite3_finalize(statement) }
        var rows: [Row] = []
        while true {
            let rc = sqlite3_step(statement)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw DbError(message: lastError) }
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
    @discardableResult
    func transaction<T>(_ body: () throws -> T) throws -> T {
        try execScript("BEGIN IMMEDIATE")
        do {
            let result = try body()
            try execScript("COMMIT")
            return result
        } catch {
            try? execScript("ROLLBACK")
            throw error
        }
    }

    private var lastError: String { String(cString: sqlite3_errmsg(handle)) }

    private func prepare(_ sql: String, _ params: [SQLValue]) throws -> OpaquePointer {
        var prepared: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &prepared, nil) == SQLITE_OK, let statement = prepared else {
            throw DbError(message: lastError)
        }
        for (offset, value) in params.enumerated() {
            let index = Int32(offset + 1)
            let rc: Int32
            switch value {
            case .null: rc = sqlite3_bind_null(statement, index)
            case .integer(let n): rc = sqlite3_bind_int64(statement, index, n)
            case .real(let d): rc = sqlite3_bind_double(statement, index, d)
            case .text(let s): rc = sqlite3_bind_text(statement, index, s, -1, transient)
            }
            if rc != SQLITE_OK {
                let message = lastError
                sqlite3_finalize(statement)
                throw DbError(message: message)
            }
        }
        return statement
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
