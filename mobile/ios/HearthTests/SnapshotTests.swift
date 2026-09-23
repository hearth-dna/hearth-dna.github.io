import XCTest
@testable import Hearth

/// A backup written here restores to the same family, plain and sealed, and the web opens it:
/// with `UPDATE_FIXTURES` set in the test scheme's environment it writes mobile/fixtures/ios.hearth,
/// which frontend/src/export/fixtures.test.ts restores and compares with the genome fixture's journal.
final class SnapshotTests: XCTestCase {
    static let fixtures = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // HearthTests
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // mobile
        .appendingPathComponent("fixtures")

    static func fixture(_ name: String) throws -> Data {
        try Data(contentsOf: fixtures.appendingPathComponent(name))
    }

    /// A repository holding the genome fixture.
    static func loaded() throws -> Repo {
        let repo = try makeTestRepo()
        _ = try Restore.run(Container.open(fixture("genomes.hearth"), passphrase: nil), into: repo)
        return repo
    }

    /// Table contents as sorted strings, for comparing two databases.
    static func dump(_ repo: Repo) throws -> [String: [String]] {
        var out: [String: [String]] = [:]
        for table in ["person", "relationship", "source_file", "health_log", "attachment", "note", "genotype"] {
            out[table] = try repo.db.query("SELECT * FROM \(table)").map { row in
                row.keys.sorted().map { "\($0)=\(row[$0]!)" }.joined(separator: "|")
            }.sorted()
        }
        return out
    }

    func testASnapshotRestoresToTheSameFamilyGenomesIncluded() throws {
        let a = try SnapshotTests.loaded()
        for pass in [nil, "trés secret"] as [String?] {
            let bytes = try SnapshotWriter.bytes(a, appVersion: "test", passphrase: pass)
            XCTAssertEqual(Container.isEncrypted(bytes), pass != nil)
            let b = try makeTestRepo()
            let r = try Restore.bytes(bytes, passphrase: pass, into: b)
            XCTAssertEqual(r.genomes, 2)
            XCTAssertEqual(try SnapshotTests.dump(a), try SnapshotTests.dump(b))
            XCTAssertEqual(try Container.open(bytes, passphrase: pass).header.generation.map { String($0) }, try a.getMeta("generation"))
        }
    }

    func testHeaderJSONIsTheFirstEntryStoredSoAFolderCanReadItFromTheFirstBytes() throws {
        let bytes = [UInt8](try SnapshotWriter.bytes(SnapshotTests.loaded(), appVersion: "test"))
        XCTAssertEqual(Array(bytes[0..<4]), [0x50, 0x4b, 0x03, 0x04])
        XCTAssertEqual(bytes[8] | bytes[9], 0) // method 0: stored
        XCTAssertEqual(String(decoding: bytes[30..<41], as: UTF8.self), "header.json")
        XCTAssertEqual(Backup.readHeaderPrefix(Data(bytes.prefix(4096)))?.format, "hearth-dump")
    }

    func testAFolderSnapshotListsItsGenomesButKeepsThemBesideIt() throws {
        let s = try SnapshotWriter.build(SnapshotTests.loaded(), appVersion: "test", embed: false)
        XCTAssertEqual(s.manifest["external_genomes"] as? Bool, true)
        XCTAssertEqual(s.files.count, 2)
        XCTAssertTrue(s.genomes.isEmpty)
    }

    func testTheZipWriterRoundTripsThroughTheReader() throws {
        var zip = ZipWriter()
        let text = Data(String(repeating: "Hearth ", count: 500).utf8)
        try zip.add("a.txt", text, deflate: true)
        try zip.add("b.bin", Data([1, 2, 3]), deflate: false)
        let reader = try ZipReader(zip.finish())
        XCTAssertEqual(try reader.read("a.txt"), text)
        XCTAssertEqual(try reader.read("b.bin"), Data([1, 2, 3]))
        XCTAssertEqual(reader.files.map(\.name), ["a.txt", "b.bin"])
    }

    func testReadsAV1Dump() throws {
        let v1: [String: Any] = [
            "format": "hearth-dump", "version": 1, "app_version": "x", "exported_at": "2025-01-01T00:00:00.000Z",
            "persons": [["id": "p1", "label": "a", "displayName": "A", "sex": "female", "birthYear": 1970, "notes": "", "createdAt": "t"] as [String: Any]],
            "relationships": [] as [Any],
            "source_files": [] as [Any],
            "snp_index": ["rsids": ["rs1", "rs2"], "chromosomes": ["1", "2"], "positions": [10, 20]] as [String: Any],
            "genotypes": ["p1": "AG--"],
            "consents": [] as [Any], "notes": [] as [Any], "chats": [] as [Any], "sharing_log": [] as [Any],
        ]
        let repo = try makeTestRepo()
        let bytes = try Gzip.compress(JSONSerialization.data(withJSONObject: v1))
        let r = try Restore.bytes(bytes, passphrase: nil, into: repo)
        XCTAssertEqual(r.persons, 1)
        XCTAssertEqual(try repo.genotypeCounts(), ["p1": 1])
    }

    func testWritesTheFixtureTheWebReadsBack() throws {
        guard ProcessInfo.processInfo.environment["UPDATE_FIXTURES"] != nil else { return }
        try SnapshotWriter.bytes(SnapshotTests.loaded(), appVersion: "fixture")
            .write(to: SnapshotTests.fixtures.appendingPathComponent("ios.hearth"))
    }
}
