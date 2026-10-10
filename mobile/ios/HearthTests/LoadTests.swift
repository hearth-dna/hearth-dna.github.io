import XCTest
@testable import Hearth

/// Loading what was picked, in one go (scheduler.ts `loadFiles`; the Android LoadTest): a folder
/// snapshot that arrives without the genome files it keeps beside itself, and those files, in any
/// order and form.
final class LoadTests: XCTestCase {
    private struct Folder {
        let snapshot: NamedFile
        let genomes: [NamedFile]
        let names: Set<String>
    }

    /// A phone's view of a folder backup of the genomes fixture: the snapshot alone, and the genome files by name.
    private func folder() throws -> Folder {
        let a = try SnapshotTests.loaded()
        let s = try SnapshotWriter.build(a, appVersion: "test", embed: false)
        let files = try s.files.map { NamedFile(name: String($0.path.split(separator: "/").last!), data: try XCTUnwrap(a.blobs.get($0.blob))) }
        return Folder(
            snapshot: NamedFile(name: "hearth-snapshot.hearth", data: try SnapshotWriter.serialise(s)),
            genomes: files,
            names: Set(try a.persons().map(\.displayName))
        )
    }

    func testAFolderSnapshotPickedAloneNamesWhoStillNeedsAGenomeAndKeepsAsking() throws {
        let f = try folder()
        let repo = try makeTestRepo()
        let r = try Loader.load(repo, [f.snapshot], passphrase: nil)
        XCTAssertEqual(r.dumps, 1)
        XCTAssertEqual(r.name, "hearth-snapshot.hearth")
        XCTAssertEqual(r.people, 2)
        XCTAssertEqual(r.genomes, 0)
        XCTAssertEqual(Set(Loader.waiting(repo).map(\.name)), f.names)
        XCTAssertTrue(try repo.genotypeCounts().isEmpty)
        // Picking the genome files later, on their own, finishes the job.
        let later = try Loader.load(repo, f.genomes, passphrase: nil)
        XCTAssertEqual(later.dumps, 0)
        XCTAssertEqual(later.genomes, 2)
        XCTAssertEqual(later.dna.count, 2)
        XCTAssertEqual(later.unused, [])
        XCTAssertEqual(try repo.genotypeCounts().count, 2)
        XCTAssertTrue(Loader.waiting(repo).isEmpty)
    }

    func testASnapshotAndItsGenomeFilesPickedTogetherLoadInOneGoWhateverTheOrder() throws {
        let f = try folder()
        let repo = try makeTestRepo()
        let r = try Loader.load(repo, f.genomes.reversed() + [f.snapshot], passphrase: nil)
        XCTAssertEqual(r.genomes, 2)
        XCTAssertEqual(r.people, 2)
        XCTAssertEqual(Set(r.dna.map(\.name)), f.names)
        XCTAssertEqual(try repo.genotypeCounts().count, 2)
    }

    func testKnowsAGenomeHandedOverDecompressedByTheTextInside() throws {
        let f = try folder()
        let repo = try makeTestRepo()
        let plain = try f.genomes.map { NamedFile(name: $0.name.replacingOccurrences(of: ".gz", with: ""), data: try Gzip.decompress($0.data)) }
        let r = try Loader.load(repo, plain + [f.snapshot], passphrase: nil)
        XCTAssertEqual(r.genomes, 2)
        XCTAssertEqual(r.unused, [])
        // Originals are kept so this phone's own backups ship them too.
        XCTAssertTrue(repo.blobs.list().contains { $0.hasPrefix("genome-") })
    }

    func testOpensAZippedBackupFolderTakingTheSnapshotAndTheGenomesAndLeavingTheRest() throws {
        let f = try folder()
        var zip = ZipWriter()
        try zip.add("Hearth/hearth.hearth", f.snapshot.data, deflate: false)
        try zip.add("Hearth/hearth.hearth.1", f.snapshot.data, deflate: false)
        try zip.add("Hearth/README.txt", Data("hi".utf8), deflate: false)
        try zip.add("__MACOSX/Hearth/._hearth.hearth", f.snapshot.data, deflate: false)
        for g in f.genomes { try zip.add("Hearth/genomes/\(g.name)", g.data, deflate: false) }
        let repo = try makeTestRepo()
        let r = try Loader.load(repo, [NamedFile(name: "Hearth.zip", data: try zip.finish())], passphrase: nil)
        XCTAssertEqual(r.dumps, 1)
        XCTAssertEqual(r.genomes, 2)
        XCTAssertEqual(r.name, "hearth.hearth")
        XCTAssertEqual(r.unused, [])
    }

    func testReportsFilesThatAreNobodysDNAAndSealedFilesThePassphraseDidNotOpen() throws {
        let f = try folder()
        let repo = try makeTestRepo()
        let r = try Loader.load(repo, [f.snapshot, NamedFile(name: "notes.txt", data: Data("hello".utf8))], passphrase: nil)
        XCTAssertEqual(r.unused, ["notes.txt"])
        XCTAssertEqual(r.unopened, [])
        let sealed = try Sealer("right").seal(f.genomes[0].data)
        let s = try Loader.load(repo, [NamedFile(name: "x.gz", data: sealed)], passphrase: "wrong")
        XCTAssertEqual(s.unopened, ["x.gz"])
    }

    func testASingleFileThatIsNotRecognisablyABackupGetsTheRestoresOwnMessage() throws {
        let repo = try makeTestRepo()
        XCTAssertThrowsError(try Loader.load(repo, [NamedFile(name: "x", data: Data("not a backup".utf8))], passphrase: nil)) { error in
            XCTAssertEqual(error as? BackupError, .notABackup)
        }
    }
}
