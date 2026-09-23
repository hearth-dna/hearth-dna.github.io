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
///
/// The generation bump and the dropping of the cached genotype counts happen in `Db.run` and
/// `Db.insertMany`, as the web's worker does them, so nothing here repeats them.
final class Repo {
    let db: Db
    let blobs: Blobs

    init(db: Db, blobs: Blobs) {
        self.db = db
        self.blobs = blobs
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

    @discardableResult
    func addPerson(label: String, displayName: String, sex: Sex, birthYear: Int?) throws -> Person {
        let p = Person(
            id: newId(), label: label, displayName: displayName, sex: sex.rawValue, birthYear: birthYear,
            notes: "", createdAt: nowISO()
        )
        try db.transaction {
            try db.run(
                "INSERT INTO person(id,label,display_name,sex,birth_year,notes,created_at) VALUES (?,?,?,?,?,?,?)",
                [
                    .text(p.id), .text(p.label), .text(p.displayName), .text(p.sex),
                    p.birthYear.map { SQLValue.integer(Int64($0)) } ?? .null, .text(p.notes), .text(p.createdAt),
                ]
            )
        }
        return p
    }

    func updatePerson(id: String, displayName: String, sex: Sex, birthYear: Int?) throws {
        try db.transaction {
            try db.run(
                "UPDATE person SET display_name=?, sex=?, birth_year=? WHERE id=?",
                [
                    .text(displayName), .text(sex.rawValue),
                    birthYear.map { SQLValue.integer(Int64($0)) } ?? .null, .text(id),
                ]
            )
        }
    }

    /// Their genotypes, entries and links go too (ON DELETE CASCADE); then the files nothing needs.
    func deletePerson(id: String) throws {
        try db.transaction { try db.run("DELETE FROM person WHERE id = ?", [.text(id)]) }
        try pruneBlobs()
    }

    // MARK: - Pedigree

    func setParent(parentId: String, childId: String) throws {
        try db.transaction {
            try db.run(
                "INSERT OR IGNORE INTO relationship(parent_id, child_id) VALUES (?,?)",
                [.text(parentId), .text(childId)]
            )
        }
    }

    func unsetParent(parentId: String, childId: String) throws {
        try db.transaction {
            try db.run(
                "DELETE FROM relationship WHERE parent_id=? AND child_id=?",
                [.text(parentId), .text(childId)]
            )
        }
    }

    func relationships() throws -> [Relationship] {
        try db.query("SELECT parent_id, child_id FROM relationship").map {
            Relationship(parentId: $0.text("parent_id"), childId: $0.text("child_id"))
        }
    }

    // MARK: - Genotypes

    /// Stores one imported file's calls and its source_file row, both or neither.
    @discardableResult
    func importCalls(
        personId: String, provider: Provider, build: String, sha256: String, originalName: String,
        calls: [Call], onProgress: ((Int) -> Void)? = nil
    ) throws -> SourceFile {
        let sf = SourceFile(
            id: newId(), personId: personId, provider: provider, build: build, sha256: sha256,
            originalName: originalName, rowCount: calls.count, importedAt: nowISO()
        )
        try db.transaction {
            try storeCalls(personId: personId, calls: calls, onProgress: onProgress)
            try insertSourceFile(sf)
        }
        return sf
    }

    /// Genotype rows only; the source_file row is the caller's business (a restore keeps the
    /// original's). Sorted by the primary key and with the rsid index dropped for the duration, as
    /// the web does: appends instead of random B-tree inserts, seconds instead of minutes.
    func storeCalls(personId: String, calls: [Call], onProgress: ((Int) -> Void)? = nil) throws {
        // Byte order, as JavaScript's `<` on these ASCII ids; Swift's String `<` agrees on ASCII.
        let sorted = calls.sorted { $0.rsid < $1.rsid }
        try db.transaction {
            try db.run("DROP INDEX IF EXISTS genotype_rsid")
            try db.insertMany(
                "INSERT OR REPLACE INTO genotype(person_id,rsid,chromosome,position,a1,a2) VALUES (?,?,?,?,?,?)",
                count: sorted.count,
                onProgress: onProgress
            ) { i in
                let c = sorted[i]
                return [.text(personId), .text(c.rsid), .text(c.chromosome), .integer(Int64(c.position)), .text(c.a1), .text(c.a2)]
            }
            try db.run("CREATE INDEX IF NOT EXISTS genotype_rsid ON genotype(rsid)")
        }
    }

    func insertSourceFile(_ sf: SourceFile) throws {
        try db.transaction {
            try db.run(
                "INSERT OR IGNORE INTO source_file(id,person_id,provider,build,sha256,original_name,row_count,imported_at) VALUES (?,?,?,?,?,?,?,?)",
                [
                    .text(sf.id), .text(sf.personId), .text(sf.provider.rawValue), .text(sf.build),
                    .text(sf.sha256), .text(sf.originalName), .integer(Int64(sf.rowCount)), .text(sf.importedAt),
                ]
            )
        }
    }

    func sourceFiles() throws -> [SourceFile] {
        try db.query("SELECT * FROM source_file ORDER BY imported_at").map { r in
            SourceFile(
                id: r.text("id"),
                personId: r.text("person_id"),
                provider: Provider.of(r.text("provider")),
                build: r.text("build"),
                sha256: r.text("sha256"),
                originalName: r.text("original_name"),
                rowCount: r.int("row_count") ?? 0,
                importedAt: r.text("imported_at")
            )
        }
    }

    /// Genotype rows per person. Counting scans every row, so the result is kept in meta until a
    /// write to the genotype table or a person delete drops it (`Db`); counting and storing is one
    /// statement, so no write slips in between.
    func genotypeCounts() throws -> [String: Int] {
        if let cached = try getMeta("genotype_counts") { return Repo.parseCounts(cached) }
        try db.run(
            """
            INSERT OR REPLACE INTO meta(key, value)
            SELECT 'genotype_counts', json_group_object(person_id, n)
            FROM (SELECT person_id, COUNT(*) AS n FROM genotype GROUP BY person_id)
            """
        )
        return Repo.parseCounts(try getMeta("genotype_counts") ?? "{}")
    }

    private static func parseCounts(_ json: String) -> [String: Int] {
        (try? JSONDecoder().decode([String: Int].self, from: Data(json.utf8))) ?? [:]
    }

    /// One rsid across everyone (the `family_all` query).
    func familyAt(_ rsid: String) throws -> [FamilyCall] {
        try db.query(
            "SELECT person_id, rsid, chromosome, position, a1, a2 FROM genotype WHERE rsid = ?",
            [.text(rsid.trimmingCharacters(in: .whitespacesAndNewlines))]
        ).map(Repo.familyCall)
    }

    func familyAtMany(_ rsids: [String]) throws -> [FamilyCall] {
        try Repo.slices(rsids).flatMap { slice in
            try db.query(
                "SELECT person_id, rsid, chromosome, position, a1, a2 FROM genotype WHERE rsid IN (\(Repo.marks(slice.count)))",
                slice.map { SQLValue.text($0) }
            ).map(Repo.familyCall)
        }
    }

    /// One person's calls at a list of rsids (kb markers, ask context), fast through the key.
    func personCallsFor(personId: String, rsids: [String]) throws -> [Call] {
        try Repo.slices(rsids).flatMap { slice in
            try db.query(
                "SELECT rsid, chromosome, position, a1, a2 FROM genotype WHERE person_id = ? AND rsid IN (\(Repo.marks(slice.count)))",
                [.text(personId)] + slice.map { SQLValue.text($0) }
            ).map(Repo.call)
        }
    }

    /// Every call for one person, for export. Hundreds of thousands of rows.
    func personCalls(personId: String) throws -> [Call] {
        try db.query(
            "SELECT rsid, chromosome, position, a1, a2 FROM genotype WHERE person_id = ? ORDER BY chromosome, position",
            [.text(personId)]
        ).map(Repo.call)
    }

    /// Mendelian consistency inside SQLite, the web's `mendelianSql`: autosomes only, no-calls
    /// excluded. With one parent a child needs one allele in common; with two, one from each.
    func mendelian(childId: String, parentA: String, parentB: String? = nil) throws -> Mendelian {
        let autosomal = "c.chromosome NOT IN ('X','Y','XY','MT') AND c.a1 <> '-' AND c.a2 <> '-'"
        let row: Row?
        if let parentB {
            row = try db.query(
                """
                SELECT COUNT(*) AS compared,
                       SUM(CASE WHEN ((c.a1 IN (p.a1,p.a2) AND c.a2 IN (q.a1,q.a2)) OR (c.a2 IN (p.a1,p.a2) AND c.a1 IN (q.a1,q.a2))) THEN 0 ELSE 1 END) AS violations
                FROM genotype c
                JOIN genotype p ON p.rsid = c.rsid AND p.person_id = ?
                JOIN genotype q ON q.rsid = c.rsid AND q.person_id = ?
                WHERE c.person_id = ? AND \(autosomal) AND p.a1 <> '-' AND p.a2 <> '-' AND q.a1 <> '-' AND q.a2 <> '-'
                """,
                [.text(parentA), .text(parentB), .text(childId)]
            ).first
        } else {
            row = try db.query(
                """
                SELECT COUNT(*) AS compared,
                       SUM(CASE WHEN (c.a1 IN (p.a1,p.a2) OR c.a2 IN (p.a1,p.a2)) THEN 0 ELSE 1 END) AS violations
                FROM genotype c
                JOIN genotype p ON p.rsid = c.rsid AND p.person_id = ?
                WHERE c.person_id = ? AND \(autosomal) AND p.a1 <> '-' AND p.a2 <> '-'
                """,
                [.text(parentA), .text(childId)]
            ).first
        }
        return Mendelian(compared: row?.int("compared") ?? 0, violations: row?.int("violations") ?? 0)
    }

    private static func call(_ r: Row) -> Call {
        Call(
            rsid: r.text("rsid"), chromosome: r.text("chromosome"), position: r.int("position") ?? 0,
            a1: r.text("a1"), a2: r.text("a2")
        )
    }

    private static func familyCall(_ r: Row) -> FamilyCall {
        FamilyCall(personId: r.text("person_id"), call: call(r))
    }

    /// In slices of 500, as the web does: well under SQLite's limit on bound parameters.
    private static func slices(_ ids: [String]) -> [[String]] {
        stride(from: 0, to: ids.count, by: 500).map { Array(ids[$0..<min($0 + 500, ids.count)]) }
    }

    private static func marks(_ n: Int) -> String {
        Array(repeating: "?", count: n).joined(separator: ",")
    }

    // MARK: - Files next to the database

    /// Where the gzipped original of a source file is kept (dump v2).
    static func genomeBlobName(_ sha256OfText: String) -> String { "genome-\(sha256OfText).gz" }

    /// A genome rebuilt for export from someone imported before originals were kept.
    static func rebuiltBlobName(personId: String, rows: Int) -> String { "generic-\(personId)-\(rows).gz" }

    /// An attached document's bytes (attachments/file.ts).
    static func attachmentBlobName(_ sha256: String) -> String { "att-\(sha256).bin" }

    /// Drops cached files nothing refers to any more (after a delete, revoke, erase or re-import):
    /// genome originals, rebuilt genomes and attached documents. The whole keep-set is built before
    /// the first delete, so a failing query aborts the sweep instead of deleting against half a set.
    func pruneBlobs() throws {
        var keep = Set<String>()
        for sf in try sourceFiles() { keep.insert(Repo.genomeBlobName(sf.sha256)) }
        for (personId, n) in try genotypeCounts() { keep.insert(Repo.rebuiltBlobName(personId: personId, rows: n)) }
        for r in try db.query("SELECT DISTINCT sha256 FROM attachment") {
            keep.insert(Repo.attachmentBlobName(r.text("sha256")))
        }
        let prunable = ["genome-", "generic-", "att-"]
        for name in blobs.list() where prunable.contains(where: { name.hasPrefix($0) }) && !keep.contains(name) {
            blobs.delete(name)
        }
    }

    // MARK: - Attachments

    func insertAttachment(_ a: Attachment) throws {
        try db.transaction {
            try db.run(
                "INSERT INTO attachment(id,health_log_id,person_id,sha256,mime,bytes,name,created_at) VALUES (?,?,?,?,?,?,?,?)",
                [
                    .text(a.id), .text(a.healthLogId), .text(a.personId), .text(a.sha256), .text(a.mime),
                    .integer(Int64(a.bytes)), .text(a.name), .text(a.createdAt),
                ]
            )
        }
    }

    /// The row, then any file no other row still refers to.
    func deleteAttachment(id: String) throws {
        try db.transaction { try db.run("DELETE FROM attachment WHERE id=?", [.text(id)]) }
        try pruneBlobs()
    }

    /// The bytes all attached documents take, each distinct file once.
    func attachmentBytesTotal() throws -> Int {
        try db.query(
            "SELECT COALESCE(SUM(bytes), 0) AS n FROM (SELECT sha256, MAX(bytes) AS bytes FROM attachment GROUP BY sha256)"
        ).first?.int("n") ?? 0
    }

    // MARK: - Sharing log

    /// Something that left the device, for the audit list in Settings (metadata, never the file).
    func logSharing(kind: String, destination: String, payload: String) throws {
        try db.transaction {
            try db.run(
                "INSERT INTO sharing_log(kind,destination,payload,created_at) VALUES (?,?,?,?)",
                [.text(kind), .text(destination), .text(payload), .text(nowISO())]
            )
        }
    }

    /// A context pack copied out (AskPage.tsx `copy`): the pack in the sharing log, where Settings
    /// shows it, and the question with its pack in `chat`, in one transaction.
    func recordCopyOut(destination: String, personIds: [String], question: String, pack: String) throws {
        try db.transaction {
            try db.run(
                "INSERT INTO sharing_log(kind,destination,payload,created_at) VALUES (?,?,?,?)",
                [.text("copy-out"), .text(destination), .text(pack), .text(nowISO())]
            )
            try db.run(
                "INSERT INTO chat(id,person_ids,question,context_pack,tier,created_at) VALUES (?,?,?,?,?,?)",
                [
                    .text(newId()), .text(personIds.joined(separator: ",")), .text(question), .text(pack),
                    .text("copy-out"), .text(nowISO()),
                ]
            )
        }
    }

    func getMeta(_ key: String) throws -> String? {
        guard let row = try db.query("SELECT value FROM meta WHERE key=?", [.text(key)]).first else { return nil }
        if case .text(let value)? = row["value"] { return value }
        return nil
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

    /// The entry and, through ON DELETE CASCADE, its attachment rows; then their files, when no
    /// other entry holds the same document.
    func deleteHealthEntry(id: String) throws {
        try db.transaction { try db.run("DELETE FROM health_log WHERE id=?", [.text(id)]) }
        try pruneBlobs()
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
