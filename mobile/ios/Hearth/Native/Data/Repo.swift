import Foundation

/// Every consent the app can ask for, with the text version it was given for (a port of
/// `frontend/src/consent/kinds.ts`). A record for an older version does not count, so the versions
/// here must move with the web's.
enum ConsentKind: String {
    case firstLaunch = "first_launch"
    case importGenome = "import_genome"
    case importMinor = "import_minor"
    case importDocument = "import_document"
    case tier3Byok = "tier3_byok"
    case readDocumentByok = "read_document_byok"
    case backupFolder = "backup_folder"
    case cloudBackup = "cloud_backup"

    var version: Int {
        switch self {
        case .cloudBackup: return 3
        default: return 1
        }
    }

    private var statementCount: Int {
        switch self {
        case .firstLaunch: return 4
        case .importGenome, .tier3Byok, .readDocumentByok, .backupFolder, .cloudBackup: return 3
        case .importMinor: return 2
        case .importDocument: return 1
        }
    }

    /// i18n key of the heading (`consent.json`).
    var titleKey: String { "consent.\(rawValue).title" }

    /// i18n keys of the statements, one confirmation each.
    var statementKeys: [String] { (1...statementCount).map { "consent.\(rawValue).statement\($0)" } }
}

/// What the screens need from the database, as `frontend/src/db/repo.ts` and `consent/consent.ts`
/// do it: the same queries, the same normalisation on write, the same ids and timestamps.
final class Repo {
    let db: Db

    init(db: Db) {
        self.db = db
    }

    // MARK: - Persons

    func persons() throws -> [Person] {
        try db.query("SELECT * FROM person ORDER BY created_at").map { r in
            Person(
                id: r.text("id"),
                label: r.text("label"),
                displayName: r.text("display_name"),
                sex: r.text("sex"),
                birthYear: r.int("birth_year"),
                notes: r.text("notes"),
                createdAt: r.text("created_at")
            )
        }
    }

    // MARK: - Health log

    /// Every person's entries, newest first: the family timeline (`listFamilyHealthLog`).
    func healthLog() throws -> [HealthEntry] {
        try db.query("SELECT * FROM health_log ORDER BY date DESC, time DESC, created_at DESC").map(Repo.entry)
    }

    /// `addHealthEntry`: body part lower-cased, tags normalised, unit trimmed, time HH:MM or ''.
    @discardableResult
    func addHealthEntry(_ draft: HealthEntry) throws -> HealthEntry {
        var e = draft
        e.id = newId()
        e.createdAt = nowISO()
        e.bodyPart = e.bodyPart.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        e.tags = HealthLog.parseTags(HealthLog.formatTags(e.tags))
        e.unit = e.unit.trimmingCharacters(in: .whitespacesAndNewlines)
        e.time = HealthLog.normTime(e.time)
        try db.transaction {
            try db.run(
                """
                INSERT INTO health_log(id,person_id,date,time,kind,title,body,source,body_part,severity,tags,value,value2,unit,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                [
                    .text(e.id), .text(e.personId), .text(e.date), .text(e.time), .text(e.kind.rawValue),
                    .text(e.title), .text(e.body), .text(e.source), .text(e.bodyPart),
                    e.severity.map { SQLValue.integer(Int64($0)) } ?? .null,
                    .text(HealthLog.formatTags(e.tags)),
                    e.value.map { SQLValue.real($0) } ?? .null,
                    e.value2.map { SQLValue.real($0) } ?? .null,
                    .text(e.unit), .text(e.createdAt),
                ]
            )
        }
        return e
    }

    /// The entry and, through ON DELETE CASCADE, its attachment rows. The web also collects the
    /// attachment files here; this app keeps none yet.
    func deleteHealthEntry(id: String) throws {
        try db.transaction { try db.run("DELETE FROM health_log WHERE id=?", [.text(id)]) }
    }

    /// Every entry's attachments, keyed by entry id; entries with none are absent (`listAttachments`).
    func attachments(entryIds: [String]) throws -> [String: [Attachment]] {
        var out: [String: [Attachment]] = [:]
        // In slices of 500, as the web does: well under SQLite's limit on bound parameters.
        var start = 0
        while start < entryIds.count {
            let slice = Array(entryIds[start..<min(start + 500, entryIds.count)])
            let marks = Array(repeating: "?", count: slice.count).joined(separator: ",")
            let rows = try db.query(
                "SELECT * FROM attachment WHERE health_log_id IN (\(marks)) ORDER BY created_at",
                slice.map { SQLValue.text($0) }
            )
            for r in rows {
                let a = Attachment(
                    id: r.text("id"),
                    healthLogId: r.text("health_log_id"),
                    personId: r.text("person_id"),
                    sha256: r.text("sha256"),
                    mime: r.text("mime"),
                    bytes: r.int("bytes") ?? 0,
                    name: r.text("name"),
                    createdAt: r.text("created_at")
                )
                out[a.healthLogId, default: []].append(a)
            }
            start += 500
        }
        return out
    }

    // MARK: - Consent

    func hasConsent(_ kind: ConsentKind, subject: String = "") throws -> Bool {
        let rows = try db.query(
            "SELECT 1 AS ok FROM consent WHERE kind=? AND version=? AND subject=? AND revoked_at IS NULL LIMIT 1",
            [.text(kind.rawValue), .integer(Int64(kind.version)), .text(subject)]
        )
        return !rows.isEmpty
    }

    /// Idempotent: one record per kind, version and subject, so a repeat grant never duplicates.
    func grantConsent(_ kind: ConsentKind, subject: String = "") throws {
        try db.transaction {
            if try hasConsent(kind, subject: subject) { return }
            try db.run(
                "INSERT INTO consent(kind,version,subject,granted_at) VALUES (?,?,?,?)",
                [.text(kind.rawValue), .integer(Int64(kind.version)), .text(subject), .text(nowISO())]
            )
        }
    }

    /// `rowToHealthEntry`. A kind this build does not know (written by a newer app) shows as Other
    /// rather than hiding the row; the stored value is untouched.
    private static func entry(_ r: Row) -> HealthEntry {
        HealthEntry(
            id: r.text("id"),
            personId: r.text("person_id"),
            date: r.text("date"),
            time: HealthLog.normTime(r.text("time")),
            kind: HealthKind(rawValue: r.text("kind")) ?? .other,
            title: r.text("title"),
            body: r.text("body"),
            source: r.text("source"),
            bodyPart: r.text("body_part"),
            severity: r.int("severity"),
            tags: HealthLog.parseTags(r.text("tags")),
            value: r.double("value"),
            value2: r.double("value2"),
            unit: r.text("unit"),
            createdAt: r.text("created_at")
        )
    }
}
