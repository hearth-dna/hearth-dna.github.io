import Foundation

/// What a restore did, for the message the user sees afterwards.
struct RestoreResult: Equatable {
    /// People that were not here before.
    let persons: Int
    /// Health log entries that were not here before.
    let healthEntries: Int
    /// Genomes loaded: only for people who had no genotypes here yet.
    let genomes: Int
    /// Attachment rows restored or already here, whose files a backup file does not carry (they
    /// travel in the backup folder, which this build does not read yet).
    let skippedAttachmentFiles: Int
    let exportedAt: String
}

/// Merges an opened dump v2 into the database, a port of `restoreContainer` in
/// `frontend/src/export/restore.ts`:
///
/// - a union by id: `INSERT OR IGNORE` per row, so whatever is already here is left alone and a
///   second restore of the same file adds nothing;
/// - column names from the allowlists below, never from the file;
/// - health rows get `withDefaults()` for columns an older file lacks;
/// - an attachment row whose entry is absent is skipped, a consent is added only when no row with
///   the same kind, version and subject exists, and a sharing-log row only when no row with the same
///   kind, destination and time does;
/// - genotypes load only for people who have none yet, parsed with the manifest's provider for an
///   original file and as generic text otherwise; an original is kept as a blob so this phone's own
///   backups ship it too.
///
/// Unlike the web, everything happens in one transaction: a row that breaks a constraint (a
/// damaged file) rolls the whole restore back instead of leaving it half merged.
///
/// Attachment bytes come from the backup folder, which this build does not read; the result counts
/// them so the screen can say so. Slow with genomes in the file: call it off the main thread.
enum Restore {
    static let personCols = ["id", "label", "display_name", "sex", "birth_year", "notes", "created_at"]
    static let sourceFileCols = [
        "id", "person_id", "provider", "build", "sha256", "original_name", "row_count", "imported_at",
    ]
    static let healthCols = [
        "id", "person_id", "date", "time", "kind", "title", "body", "source", "body_part", "severity",
        "tags", "value", "value2", "unit", "created_at",
    ]
    static let attachmentCols = ["id", "health_log_id", "person_id", "sha256", "mime", "bytes", "name", "created_at"]
    static let noteCols = ["id", "person_id", "topic", "markdown", "updated_at"]
    static let chatCols = ["id", "person_ids", "question", "context_pack", "answer", "tier", "created_at"]

    /// `withDefaults()`: only for a key the row does not have. A key present with null stays null,
    /// as the spread in the web code leaves it.
    private static let healthDefaults: JSONRow = [
        "time": .string(""), "source": .string(""), "body_part": .string(""), "severity": .null,
        "tags": .string(""), "value": .null, "value2": .null, "unit": .string(""),
    ]

    /// `onProgress` gets an i18n key from `restore.json` and its placeholders, on the calling thread.
    static func run(
        _ dump: Dump, into repo: Repo,
        onProgress: ((String, [String: CustomStringConvertible]) -> Void)? = nil
    ) throws -> RestoreResult {
        let db = repo.db
        return try db.transaction { () throws -> RestoreResult in
            let hadGenotypes = try Set(db.query("SELECT DISTINCT person_id FROM genotype").map { $0.text("person_id") })
            let peopleBefore = try count(db, "person")
            let entriesBefore = try count(db, "health_log")

            try insertRows(db, "person", personCols, dump.rows("persons"))
            for r in try dump.rows("relationships") {
                try db.run(
                    "INSERT OR IGNORE INTO relationship(parent_id, child_id) VALUES (?,?)",
                    [sqlValue(r["parentId"]), sqlValue(r["childId"])]
                )
            }
            try insertRows(db, "source_file", sourceFileCols, dump.rows("source_files"))
            let health = try dump.rows("health_log").map { row in
                row.merging(healthDefaults) { present, _ in present }
            }
            try insertRows(db, "health_log", healthCols, health)
            let attachments = try dump.rows("attachments")
            try insertAttachments(db, attachments)
            try insertRows(db, "note", noteCols, dump.rows("notes"))
            try insertRows(db, "chat", chatCols, dump.rows("chats"))
            try insertConsents(db, dump.rows("consents"))
            for s in try dump.rows("sharing_log") {
                let kind = try sqlValue(s["kind"])
                let destination = try sqlValue(s["destination"])
                let createdAt = try sqlValue(s["created_at"])
                try db.run(
                    """
                    INSERT INTO sharing_log(kind,destination,payload,created_at) SELECT ?,?,?,?
                    WHERE NOT EXISTS (SELECT 1 FROM sharing_log WHERE kind=? AND destination=? AND created_at=?)
                    """,
                    [kind, destination, sqlValue(s["payload"]), createdAt, kind, destination, createdAt]
                )
            }

            let persons = try count(db, "person") - peopleBefore
            let healthEntries = try count(db, "health_log") - entriesBefore

            var genomes = 0
            for g in dump.genomes where !hadGenotypes.contains(g.personId) {
                // A folder backup keeps its genomes beside it; one not there yet loads next time.
                guard let gz = dump.genomeFiles[g.path] else { continue }
                let text: String
                do {
                    text = GenomeImport.decode(try Gzip.decompress(gz))
                } catch {
                    throw BackupError.damaged
                }
                onProgress?("restore.parsingGenome", ["n": genomes + 1, "total": dump.genomes.count])
                let parsed = GenomeParser.parseRawText(text, forced: g.original ? Provider.of(g.provider) : .generic)
                onProgress?("restore.storingCalls", ["n": parsed.calls.count])
                try repo.storeCalls(personId: g.personId, calls: parsed.calls)
                if g.original { try repo.blobs.put(Repo.genomeBlobName(sha256Hex(text)), gz) }
                genomes += 1
            }

            return RestoreResult(
                persons: persons,
                healthEntries: healthEntries,
                genomes: genomes,
                skippedAttachmentFiles: attachments.count,
                exportedAt: dump.exportedAt
            )
        }
    }

    // MARK: - Private

    /// `insertRows`. `table` and `cols` are the constants above; only values come from the file.
    private static func insertRows(_ db: Db, _ table: String, _ cols: [String], _ rows: [JSONRow]) throws {
        let sql = "INSERT OR IGNORE INTO \(table)(\(cols.joined(separator: ","))) VALUES (\(marks(cols.count)))"
        for r in rows {
            try db.run(sql, cols.map { try sqlValue(r[$0]) })
        }
    }

    /// `insertAttachmentRows`: ON CONFLICT does not cover foreign-key violations, so an orphan row
    /// from a damaged file would abort the restore; the WHERE EXISTS skips it instead.
    private static func insertAttachments(_ db: Db, _ rows: [JSONRow]) throws {
        let sql = """
            INSERT OR IGNORE INTO attachment(\(attachmentCols.joined(separator: ",")))
            SELECT \(marks(attachmentCols.count))
            WHERE EXISTS (SELECT 1 FROM health_log WHERE id = ?)
            """
        for a in rows {
            try db.run(sql, attachmentCols.map { try sqlValue(a[$0]) } + [sqlValue(a["health_log_id"])])
        }
    }

    /// `insertConsents`: camelCase in the journal. A row carrying `revokedAt` comes from before
    /// revoking meant deleting, and stays revoked.
    private static func insertConsents(_ db: Db, _ rows: [JSONRow]) throws {
        for c in rows {
            if c["revokedAt"]?.isTruthy == true || c["revoked_at"]?.isTruthy == true { continue }
            let kind = try sqlValue(c["kind"])
            let version = try sqlValue(c["version"])
            let subject = try sqlValue(c["subject"])
            // `c.grantedAt ?? c.granted_at`: the camelCase name unless it is missing or null.
            let camel = c["grantedAt"] ?? .null
            let grantedAt = try sqlValue(camel == .null ? c["granted_at"] : Optional(camel))
            try db.run(
                """
                INSERT INTO consent(kind,version,subject,granted_at) SELECT ?,?,?,?
                WHERE NOT EXISTS (SELECT 1 FROM consent WHERE kind=? AND version=? AND subject=?)
                """,
                [kind, version, subject, grantedAt, kind, version, subject]
            )
        }
    }

    /// A journal value as a bound parameter, the way the web's SQLite binding takes it: a missing
    /// key is NULL, a whole number an integer, a boolean 1 or 0. An array or object has no column
    /// to go in; the web's binding throws on one too, so the file is damaged.
    private static func sqlValue(_ value: JSONValue?) throws -> SQLValue {
        switch value {
        case nil, .null?:
            return .null
        case .bool(let b)?:
            return .integer(b ? 1 : 0)
        case .number(let n)?:
            if n.rounded() == n && abs(n) < 9e15 { return .integer(Int64(n)) }
            return .real(n)
        case .string(let s)?:
            return .text(s)
        case .array?, .object?:
            throw BackupError.damaged
        }
    }

    private static func marks(_ n: Int) -> String {
        Array(repeating: "?", count: n).joined(separator: ",")
    }

    private static func count(_ db: Db, _ table: String) throws -> Int {
        try db.query("SELECT COUNT(*) AS n FROM \(table)").first?.int("n") ?? 0
    }
}
