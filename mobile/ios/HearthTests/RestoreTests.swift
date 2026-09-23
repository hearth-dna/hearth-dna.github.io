import XCTest
@testable import Hearth

/// The golden backups in `mobile/fixtures/`, written by the web app's own code (ADR 0010): each is
/// restored into a fresh database, which must then hold exactly the rows of `journal.json`.
///
/// The files are read from the repository through `#filePath`; the simulator runs on the Mac that
/// built the tests and can read them there.
final class RestoreTests: XCTestCase {
    private static let passphrase = "correct horse battery staple"

    private let fixtures = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // HearthTests
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // mobile
        .appendingPathComponent("fixtures")

    private func fixture(_ name: String) throws -> Data {
        try Data(contentsOf: fixtures.appendingPathComponent(name))
    }

    private func journal() throws -> [String: JSONValue] {
        try JSONDecoder().decode([String: JSONValue].self, from: fixture("journal.json"))
    }

    func testRestoresThePlainFixture() throws {
        let dump = try Container.open(fixture("plain.hearth"), passphrase: nil)
        XCTAssertFalse(dump.encrypted)
        try assertRestoresExactly(dump)
    }

    func testRestoresTheEncryptedFixture() throws {
        let data = try fixture("encrypted.hearth")
        XCTAssertTrue(Container.isEncrypted(data))
        let dump = try Container.open(data, passphrase: RestoreTests.passphrase)
        XCTAssertTrue(dump.encrypted)
        try assertRestoresExactly(dump)
    }

    func testAnEncryptedFileNeedsTheRightPassphrase() throws {
        let data = try fixture("encrypted.hearth")
        XCTAssertThrowsError(try Container.open(data, passphrase: nil)) { error in
            XCTAssertEqual(error as? BackupError, .passphraseRequired)
        }
        XCTAssertThrowsError(try Container.open(data, passphrase: "wrong horse")) { error in
            XCTAssertEqual(error as? BackupError, .wrongPassphrase)
        }
    }

    func testRefusesAFileThatIsNotABackup() {
        XCTAssertThrowsError(try Container.open(Data("{\"format\":\"hearth\"}".utf8), passphrase: nil)) { error in
            XCTAssertEqual(error as? BackupError, .notABackup)
        }
    }

    /// A truncated zip must be refused as damaged, not crash and not restore half a file.
    func testRefusesATruncatedBackup() throws {
        let data = try fixture("plain.hearth")
        XCTAssertThrowsError(try Container.open(data.prefix(data.count / 2), passphrase: nil)) { error in
            XCTAssertEqual(error as? BackupError, .damaged)
        }
    }

    /// Restore merges: a second run adds nothing and changes nothing.
    func testRestoringTwiceDoesNotDuplicate() throws {
        let repo = try makeTestRepo()
        let dump = try Container.open(fixture("plain.hearth"), passphrase: nil)
        let first = try Restore.run(dump, into: repo)
        XCTAssertEqual(first, RestoreResult(
            persons: 2, healthEntries: 4, genomes: 0, skippedAttachmentFiles: 1,
            exportedAt: "2026-09-21T00:00:00.000Z"
        ))

        let second = try Restore.run(dump, into: repo)
        XCTAssertEqual(second, RestoreResult(
            persons: 0, healthEntries: 0, genomes: 0, skippedAttachmentFiles: 1, exportedAt: first.exportedAt
        ))
        try assertTables(repo.db, match: journal())
    }

    /// The genome fixture: both genomes load, the originals are kept under the hash of their text
    /// (which the source_file rows name), and a second restore loads nothing again.
    func testRestoresBothGenomesAndKeepsTheOriginals() throws {
        let repo = try makeTestRepo()
        let dump = try Container.open(fixture("genomes.hearth"), passphrase: nil)
        XCTAssertEqual(dump.genomeFiles.count, 2)
        XCTAssertEqual(try Restore.run(dump, into: repo).genomes, 2)
        XCTAssertEqual(try repo.genotypeCounts(), ["p-alex": 7, "p-sam": 7])
        let sam = try XCTUnwrap(repo.familyAt("rs429358").first { $0.personId == "p-sam" }).call
        XCTAssertEqual([sam.a1, sam.a2], ["T", "T"])

        let shas = try Set(repo.sourceFiles().map(\.sha256))
        XCTAssertEqual(Set(shas.map(Repo.genomeBlobName)), Set(repo.blobs.list()))
        for name in repo.blobs.list() {
            let text = try GenomeImport.decode(Gzip.decompress(XCTUnwrap(repo.blobs.get(name))))
            XCTAssertEqual(name, Repo.genomeBlobName(sha256Hex(text)))
        }

        XCTAssertEqual(try Restore.run(dump, into: repo).genomes, 0)
        // Sam's rs4680 is AA against Alex's GG: one violation among the six autosomal calls.
        let m = try repo.mendelian(childId: "p-sam", parentA: "p-alex")
        XCTAssertEqual(m, Mendelian(compared: 6, violations: 1))
    }

    /// A genome whose bytes do not match the manifest refuses the whole file.
    func testRefusesATamperedGenome() throws {
        let data = try fixture("genomes.hearth")
        let path = try XCTUnwrap(Container.open(data, passphrase: nil).genomes.first?.path)
        // Flip a byte inside the first genome's stored zip entry, just past its local header's name.
        let at = try XCTUnwrap(data.range(of: Data(path.utf8))).upperBound + 20
        var broken = data
        broken[at] ^= 1
        XCTAssertThrowsError(try Container.open(broken, passphrase: nil)) { error in
            XCTAssertEqual(error as? BackupError, .damaged)
        }
    }

    /// What the screens read back is the same data: tags parsed, the value as a number, an
    /// untimed entry with no time, the attachment under its entry.
    func testTheRepositoryReadsRestoredRows() throws {
        let repo = try makeTestRepo()
        _ = try Restore.run(Container.open(fixture("plain.hearth"), passphrase: nil), into: repo)
        XCTAssertEqual(try repo.persons().map(\.displayName), ["Alex", "Sam"])
        let log = try repo.healthLog()
        XCTAssertEqual(log.map(\.id), ["h-1", "h-2", "h-3", "h-4"])
        let pain = try XCTUnwrap(log.first { $0.id == "h-2" })
        XCTAssertEqual(pain.tags, ["arthritis", "flare"])
        XCTAssertEqual(pain.severity, 6)
        XCTAssertEqual(HealthLog.formatValue(log[0]), "128/84 mmHg")
        XCTAssertEqual(try repo.attachments(entryIds: log.map(\.id))["h-4"]?.map(\.name), ["cbc.pdf"])
        XCTAssertTrue(try repo.hasConsent(.importDocument, subject: "p-alex"))
        XCTAssertFalse(try repo.hasConsent(.importDocument, subject: "p-sam"))
    }

    func testAddingAndDeletingAnEntry() throws {
        let repo = try makeTestRepo()
        _ = try Restore.run(Container.open(fixture("plain.hearth"), passphrase: nil), into: repo)
        let added = try repo.addHealthEntry(HealthEntry(
            id: "", personId: "p-sam", date: "2026-09-20", time: "7:05", kind: .symptom, title: "Cough",
            body: "", source: "", bodyPart: " Lungs ", severity: 3, tags: ["Cold", "cold "], value: nil,
            value2: nil, unit: "", createdAt: ""
        ))
        XCTAssertEqual(added.time, "07:05")
        XCTAssertEqual(added.bodyPart, "lungs")
        XCTAssertEqual(added.tags, ["cold"])
        XCTAssertEqual(added.id.count, 36)
        XCTAssertEqual(try repo.healthLog().first?.id, added.id)

        // Deleting h-4 takes its attachment row with it (foreign keys are on).
        try repo.deleteHealthEntry(id: "h-4")
        XCTAssertEqual(try repo.db.query("SELECT COUNT(*) AS n FROM attachment").first?.int("n"), 0)
    }

    func testGrantingConsentIsIdempotent() throws {
        let repo = try makeTestRepo()
        try repo.grantConsent(.importDocument, subject: "p")
        try repo.grantConsent(.importDocument, subject: "p")
        XCTAssertTrue(try repo.hasConsent(.importDocument, subject: "p"))
        XCTAssertEqual(try repo.db.query("SELECT COUNT(*) AS n FROM consent").first?.int("n"), 1)
    }

    func testEveryUserDataWriteBumpsTheGeneration() throws {
        let repo = try makeTestRepo()
        let db = repo.db
        let generation = { try db.query("SELECT value FROM meta WHERE key='generation'").first?.text("value") }
        XCTAssertEqual(try generation(), "0")
        try repo.grantConsent(.firstLaunch)
        try repo.grantConsent(.firstLaunch) // already there: nothing written, nothing bumped
        XCTAssertEqual(try generation(), "1")
        // A write that changes nothing is not a change, as in the web's worker.
        try db.run("DELETE FROM health_log WHERE id = ?", [.text("absent")])
        XCTAssertEqual(try generation(), "1")
        XCTAssertTrue(Db.isWrite("  insert into person(id) values (?)"))
        XCTAssertFalse(Db.isWrite("INSERT INTO meta(key, value) VALUES ('x', 'y')"))
        XCTAssertFalse(Db.isWrite("SELECT * FROM person"))
    }

    /// Writes that can change someone's genotype count drop the cached counts; others keep them.
    func testGenotypeWritesDropTheCachedCounts() throws {
        XCTAssertTrue(Db.touchesGenotypes("INSERT OR REPLACE INTO genotype(person_id) VALUES (?)"))
        XCTAssertTrue(Db.touchesGenotypes(" delete from person where id = ?"))
        XCTAssertFalse(Db.touchesGenotypes("DELETE FROM health_log WHERE id=?"))
        XCTAssertFalse(Db.touchesGenotypes("SELECT * FROM genotype"))

        let repo = try makeTestRepo()
        let p = try repo.addPerson(label: "a", displayName: "A", sex: .unknown, birthYear: nil)
        XCTAssertEqual(try repo.genotypeCounts(), [:])
        XCTAssertNotNil(try repo.getMeta("genotype_counts"))
        try repo.storeCalls(personId: p.id, calls: [
            Call(rsid: "rs2", chromosome: "1", position: 20, a1: "A", a2: "G"),
            Call(rsid: "rs1", chromosome: "1", position: 10, a1: "C", a2: "C"),
        ])
        XCTAssertNil(try repo.getMeta("genotype_counts"))
        XCTAssertEqual(try repo.genotypeCounts(), [p.id: 2])
        try repo.grantConsent(.importGenome, subject: p.id)
        XCTAssertNotNil(try repo.getMeta("genotype_counts"))
        try repo.deletePerson(id: p.id)
        XCTAssertEqual(try repo.genotypeCounts(), [:])
    }

    /// A transaction inside another joins it: one commit, and an inner failure undoes both.
    func testNestedTransactionsCommitAndRollBackTogether() throws {
        let db = try Db(path: ":memory:")
        let insert = "INSERT INTO person(id,label,display_name,sex,created_at) VALUES (?,?,?,'unknown','2026-01-01T00:00:00.000Z')"
        let count = { try db.query("SELECT COUNT(*) AS n FROM person").first?.int("n") }
        try db.transaction {
            try db.transaction { try db.run(insert, [.text("a"), .text("a"), .text("A")]) }
        }
        XCTAssertEqual(try count(), 1)
        XCTAssertThrowsError(try db.transaction {
            try db.run(insert, [.text("b"), .text("b"), .text("B")])
            // Caught here, but the outer transaction must not commit half of the work.
            try? db.transaction { () throws -> Void in throw DbError(message: "inner") }
        })
        XCTAssertEqual(try count(), 1)
    }

    // MARK: - Comparison with journal.json

    private func assertRestoresExactly(_ dump: Dump, file: StaticString = #filePath, line: UInt = #line) throws {
        let repo = try makeTestRepo()
        _ = try Restore.run(dump, into: repo)
        try assertTables(repo.db, match: journal(), file: file, line: line)
    }

    /// Every table the journal fills, row for row and column for column. Health rows the file wrote
    /// without some columns (an older export) are expected with the web's defaults.
    private func assertTables(
        _ db: Db, match journal: [String: JSONValue], file: StaticString = #filePath, line: UInt = #line
    ) throws {
        let healthDefaults: [String: JSONValue] = [
            "time": .string(""), "source": .string(""), "body_part": .string(""), "severity": .null,
            "tags": .string(""), "value": .null, "value2": .null, "unit": .string(""),
        ]
        XCTAssertEqual(try rows(db, "SELECT * FROM person ORDER BY id"), expected(journal, "persons"), file: file, line: line)
        XCTAssertEqual(
            try rows(db, "SELECT parent_id AS parentId, child_id AS childId FROM relationship ORDER BY parent_id, child_id"),
            expected(journal, "relationships"),
            file: file, line: line
        )
        XCTAssertEqual(
            try rows(db, "SELECT * FROM health_log ORDER BY id"),
            expected(journal, "health_log").map { $0.merging(healthDefaults) { present, _ in present } },
            file: file, line: line
        )
        XCTAssertEqual(try rows(db, "SELECT * FROM attachment ORDER BY id"), expected(journal, "attachments"), file: file, line: line)
        XCTAssertEqual(try rows(db, "SELECT * FROM note ORDER BY id"), expected(journal, "notes"), file: file, line: line)
        XCTAssertEqual(
            try rows(db, "SELECT kind, version, subject, granted_at AS grantedAt FROM consent ORDER BY id"),
            expected(journal, "consents"),
            file: file, line: line
        )
        XCTAssertEqual(
            try rows(db, "SELECT kind, destination, payload, created_at FROM sharing_log ORDER BY id"),
            expected(journal, "sharing_log"),
            file: file, line: line
        )
        XCTAssertEqual(try rows(db, "SELECT * FROM source_file"), expected(journal, "source_files"), file: file, line: line)
        XCTAssertEqual(try rows(db, "SELECT * FROM chat"), expected(journal, "chats"), file: file, line: line)
    }

    /// A table's rows as JSON values, numbers as numbers whatever SQLite stored them as.
    private func rows(_ db: Db, _ sql: String) throws -> [[String: JSONValue]] {
        try db.query(sql).map { row in
            row.mapValues { value -> JSONValue in
                switch value {
                case .null: return .null
                case .integer(let n): return .number(Double(n))
                case .real(let d): return .number(d)
                case .text(let s): return .string(s)
                }
            }
        }
    }

    private func expected(_ journal: [String: JSONValue], _ key: String) -> [[String: JSONValue]] {
        guard case .array(let items)? = journal[key] else { return [] }
        return items.compactMap { item in
            guard case .object(let row) = item else { return nil }
            return row
        }
    }
}
