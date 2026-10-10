import XCTest
@testable import Hearth

/// The repair path of frontend/src/db/db.ts and export/restore.ts `rebuildGenomesFromCache` (the
/// Android RepairTest): what is salvaged from a damaged file, and the DNA rebuilt from the genome
/// files kept beside it.
final class RepairTests: XCTestCase {
    private func rows(_ db: Db, _ table: String) throws -> [String] {
        try db.query("SELECT * FROM \(table)").map { row in
            row.keys.sorted().map { "\($0)=\(row[$0]!)" }.joined(separator: "|")
        }.sorted()
    }

    func testKeepsEveryTableButGenotypesInAFreshDatabaseAndRebuildsTheDNAFromTheGenomeFiles() throws {
        let a = try SnapshotTests.loaded()
        _ = try a.genotypeCounts() // caches the counts in meta, as the app does
        let fresh = try Db(path: ":memory:")
        let kept = a.db.salvage()
        XCTAssertFalse(kept.tables.contains { $0.name == "genotype" })
        XCTAssertEqual(kept.lost, [])
        let back = try fresh.restore(kept)
        XCTAssertEqual(back["person"], 2)
        XCTAssertEqual(back["health_log"], try a.db.query("SELECT COUNT(*) AS n FROM health_log").first?.int("n"))
        for table in ["person", "relationship", "source_file", "health_log", "consent", "note"] {
            XCTAssertEqual(try rows(a.db, table), try rows(fresh, table), table)
        }
        // The device id and generation come back from the damaged file, not the new one; the cached counts do not.
        let repaired = Repo(db: fresh, blobs: a.blobs)
        XCTAssertEqual(try repaired.getMeta("device"), try a.getMeta("device"))
        XCTAssertEqual(try repaired.getMeta("generation"), try a.getMeta("generation"))
        XCTAssertNil(try repaired.getMeta("genotype_counts"))

        XCTAssertTrue(try repaired.genotypeCounts().isEmpty)
        XCTAssertEqual(try Restore.rebuildGenomesFromCache(repaired), 2)
        XCTAssertEqual(try repaired.genotypeCounts(), try a.genotypeCounts())
        XCTAssertEqual(try rows(a.db, "genotype"), try rows(fresh, "genotype"))
        // Nothing left to rebuild, and foreign keys are back on.
        XCTAssertEqual(try Restore.rebuildGenomesFromCache(repaired), 0)
        XCTAssertEqual(try fresh.query("PRAGMA foreign_keys").first?.int("foreign_keys"), 1)
    }

    func testRepairsADamagedFileOnDiskAndKeepsWhatCanStillBeRead() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("repair-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let path = folder.appendingPathComponent("user.db").path
        do {
            let repo = Repo(db: try Db(path: path), blobs: try Blobs(folder: folder.appendingPathComponent("blobs")))
            _ = try Restore.run(Container.open(SnapshotTests.fixture("genomes.hearth"), passphrase: nil), into: repo)
            repo.db.close()
        }
        // Not a database at all: nothing can be read, and the repair still leaves a working one.
        try Data("this is not a database".utf8).write(to: URL(fileURLWithPath: path))
        XCTAssertThrowsError(try Db(path: path)) { error in XCTAssertTrue(Db.isCorrupt(error)) }
        let kept = try Db.repair(path: path)
        XCTAssertEqual(kept.lost, ["sqlite_master"])
        let db = try Db(path: path)
        XCTAssertEqual(try db.query("SELECT COUNT(*) AS n FROM person").first?.int("n"), 0)
        XCTAssertTrue(db.check())
        db.close()
    }

    func testSpotsTheWordsSQLiteUsesForADamagedFile() {
        XCTAssertTrue(Db.isCorrupt("database disk image is malformed"))
        XCTAssertTrue(Db.isCorrupt("file is not a database"))
        XCTAssertTrue(Db.isCorrupt("SQLITE_CORRUPT"))
        XCTAssertFalse(Db.isCorrupt("no such table: person"))
    }
}
