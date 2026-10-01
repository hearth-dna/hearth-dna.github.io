import XCTest
@testable import Hearth

/// A backup place in memory: what a folder the picker granted looks like to the code above it.
final class MemoryDir: BackupDir {
    let name: String
    let single: Bool
    let versioned: Bool
    var files: [String: Data] = [:]
    var dirs: [String: MemoryDir] = [:]

    init(name: String = "mem", single: Bool = false, versioned: Bool = false) {
        self.name = name
        self.single = single
        self.versioned = versioned
    }

    func names() throws -> [String] { Array(files.keys) + Array(dirs.keys) }
    func read(_ name: String) throws -> Data? { files[name] }
    func readHead(_ name: String, bytes: Int) throws -> Data? { files[name].map { $0.prefix(bytes) } }
    func write(_ name: String, _ data: Data) throws { files[name] = data }

    func remove(_ name: String) throws {
        files[name] = nil
        dirs[name] = nil
    }

    func subdir(_ name: String, create: Bool) throws -> BackupDir? {
        if let d = dirs[name] { return d }
        guard create else { return nil }
        let d = MemoryDir(name: name)
        dirs[name] = d
        return d
    }
}

/// Mirrors frontend/src/backup/naming.test.ts and the folder cycle the scheduler runs (through the
/// Android DirTest).
final class BackupDirTests: XCTestCase {
    private func header(_ device: String, _ generation: Int64) -> DumpHeader {
        DumpHeader(format: "hearth-dump", version: 2, exportedAt: nil, device: device, generation: generation, encrypted: false)
    }

    func testRotationPlanAndTheNewerCopyRule() {
        XCTAssertTrue(Backup.rotationPlan([], "b").isEmpty)
        XCTAssertEqual(Backup.rotationPlan(["b"], "b").map { [$0.from, $0.to] }, [["b", "b.1"]])
        XCTAssertEqual(
            Backup.rotationPlan(["b", "b.1", "b.2", "b.3"], "b").map { [$0.from, $0.to] },
            [["b.2", "b.3"], ["b.1", "b.2"], ["b", "b.1"]]
        )
        let h = header("other", 5)
        XCTAssertTrue(Backup.hasNewer(h, ourDevice: "me", lastSeen: nil))
        XCTAssertFalse(Backup.hasNewer(h, ourDevice: "other", lastSeen: nil))
        XCTAssertFalse(Backup.hasNewer(h, ourDevice: "me", lastSeen: Seen(device: "other", generation: 5)))
        XCTAssertTrue(Backup.hasNewer(h, ourDevice: "me", lastSeen: Seen(device: "other", generation: 4)))
        XCTAssertTrue(Backup.hasNewer(h, ourDevice: "me", lastSeen: Seen(device: "third", generation: 9)))
    }

    func testAFolderBackupRoundTripsWithGenomesAndSealedDocumentsBesideIt() throws {
        let a = try SnapshotTests.loaded()
        let e = try a.addHealthEntry(HealthEntry(
            id: "", personId: "p-alex", date: "2026-01-01", time: "", kind: .lab, title: "CBC", body: "", source: "",
            bodyPart: "", severity: nil, tags: [], value: nil, value2: nil, unit: "", createdAt: ""
        ))
        let pdf = Data("%PDF-1.7 page".utf8) + Data(count: 16)
        try Attachments.add(a, healthLogId: e.id, personId: "p-alex", data: pdf, name: "cbc.pdf", already: 0)

        let dir = MemoryDir()
        let pass = "secret"
        for _ in 0..<2 {
            let snap = try SnapshotWriter.build(a, appVersion: "test", embed: false)
            try Backup.mirrorGenomes(dir, a, snap.files, passphrase: pass)
            try Backup.writeSnapshot(dir, SnapshotWriter.serialise(snap, passphrase: pass), appURL: "https://hearth.example")
        }
        XCTAssertEqual(Set(try dir.names()), [Backup.snapshot, "\(Backup.snapshot).1", "README.txt", Backup.genomesDir])
        XCTAssertEqual(try Backup.mirrorAttachments(dir, a, passphrase: pass), 1)
        XCTAssertTrue(Sealer.isSealed(try XCTUnwrap(dir.dirs[Backup.attachmentsDir]?.files.values.first)))
        XCTAssertEqual(try Backup.currentHeader(dir)?.format, "hearth-dump")

        let b = try makeTestRepo()
        let r = try Restore.bytes(
            XCTUnwrap(dir.read(Backup.snapshot)), passphrase: pass, into: b, loadGenome: Backup.genomeLoader(dir, passphrase: pass)
        )
        XCTAssertEqual(r.genomes, 2)
        // The fixture's own attachment row (a-1) has no file anywhere: one pulled, one still missing.
        let pulled = try Backup.pullAttachments(dir, b, passphrase: pass)
        XCTAssertEqual([pulled.pulled, pulled.missing], [1, 1])
        XCTAssertEqual(try a.genotypeCounts(), try b.genotypeCounts())
        XCTAssertEqual(b.blobs.list().filter { $0.hasPrefix("att-") }, [Repo.attachmentBlobName(sha256Hex(pdf))])
    }

    func testASingleFileHoldsOnlyTheSnapshot() throws {
        let dir = MemoryDir(single: true)
        try Backup.writeSnapshot(dir, Data([1]), appURL: "x")
        XCTAssertEqual(Set(try dir.names()), [Backup.snapshot])
    }

    func testSidecarsSealAndOpen() throws {
        let sealed = try Sealer("pass").seal(Data("hello".utf8))
        XCTAssertTrue(Sealer.isSealed(sealed))
        XCTAssertEqual(try Opener("pass").open(sealed), Data("hello".utf8))
        XCTAssertThrowsError(try Opener("wrong").open(sealed))
    }
}
