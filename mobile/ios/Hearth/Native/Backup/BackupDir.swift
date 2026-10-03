import CryptoKit
import Foundation

/// Where backups go, behind one small interface (backup/folder.ts `Dir`): a folder the picker
/// granted, iCloud Drive, a single picked file, or a cloud drive. Past here the kind of place is
/// invisible. Every call does I/O and may block: run it off the main thread.
protocol BackupDir {
    var name: String { get }
    /// A single file, not a folder: it holds the snapshot and nothing beside it.
    var single: Bool { get }
    /// The provider keeps earlier versions itself (Drive, Dropbox): no `.1`/`.2` copies.
    var versioned: Bool { get }
    func names() throws -> [String]
    func read(_ name: String) throws -> Data?
    /// The first `bytes` of a file (or all of a shorter one); nil when it is not there.
    func readHead(_ name: String, bytes: Int) throws -> Data?
    func write(_ name: String, _ data: Data) throws
    /// Removes a file or a whole folder.
    func remove(_ name: String) throws
    /// A subfolder, or nil when it is not there and `create` is false.
    func subdir(_ name: String, create: Bool) throws -> BackupDir?
}

/// The header of the snapshot this phone last wrote to or loaded from the place.
struct Seen: Codable, Equatable {
    let device: String
    let generation: Int64
}

/// Naming, the snapshot in a place, and the files beside it (backup/naming.ts, folder.ts,
/// attachments/mirror.ts, genomes.ts).
enum Backup {
    static let rotations = 3
    static let snapshot = "hearth-backup.hearth"
    static let attachmentsDir = "attachments"
    static let genomesDir = "genomes"
    /// Enough for any header Hearth writes; the rest of the snapshot stays where it is.
    static let headBytes = 64 * 1024

    static func rotatedName(_ base: String, _ n: Int) -> String { "\(base).\(n)" }

    /// Copies to make, oldest first, so that `base` can then be overwritten with the newest snapshot.
    static func rotationPlan(_ existing: [String], _ base: String, keep: Int = rotations) -> [(from: String, to: String)] {
        let have = Set(existing)
        var plan: [(from: String, to: String)] = []
        for n in stride(from: keep - 1, through: 1, by: -1) where have.contains(rotatedName(base, n)) {
            plan.append((rotatedName(base, n), rotatedName(base, n + 1)))
        }
        if have.contains(base) { plan.append((base, rotatedName(base, 1))) }
        return plan
    }

    /// The place holds a snapshot newer than what this phone has loaded from it.
    static func hasNewer(_ current: DumpHeader?, ourDevice: String, lastSeen: Seen?) -> Bool {
        guard let current, let device = current.device, device != ourDevice else { return false }
        guard let lastSeen else { return true }
        return lastSeen.device != device || (current.generation ?? 0) > lastSeen.generation
    }

    static func readme(_ url: String) -> String {
        [
            "This folder is written by Hearth, a local-first family genome browser.",
            "",
            "hearth-backup*.hearth files are snapshots of everything in the app (people, genome files, health",
            "log, notes). The newest is hearth-backup.hearth; .1, .2, ... are older copies. A file starting",
            "with \"HRTH2\" is encrypted with the passphrase set in Hearth; a file starting with \"PK\" is a",
            "plain zip and readable by anyone who has it.",
            "",
            "The attachments folder holds one file per image or PDF attached to a health log entry, named",
            "after the content of the file. Files starting with \"HRTH1\" are encrypted with the same",
            "passphrase. They are written once and kept even after an entry is deleted, because the older",
            "snapshots above may still refer to them; removing one only loses that document.",
            "",
            "To restore: open \(url), go to Settings, choose this folder, and press \"Load from folder\".",
            "",
        ].joined(separator: "\n")
    }

    // MARK: - The snapshot in a place

    private static func u16(_ b: [UInt8], _ at: Int) -> Int { Int(b[at]) | Int(b[at + 1]) << 8 }
    private static func u32(_ b: [UInt8], _ at: Int) -> Int { u16(b, at) | u16(b, at + 2) << 16 }

    /// The header from a file's first bytes alone (container.ts `readHeaderPrefix`): plaintext
    /// ahead of an envelope, or the first, stored zip entry. Nil when these bytes do not settle it.
    static func readHeaderPrefix(_ data: Data) -> DumpHeader? {
        let b = [UInt8](data)
        if b.count > 7 && Array(b[0..<5]) == SnapshotWriter.magic {
            let length = Int(b[5]) << 8 | Int(b[6])
            guard b.count >= 7 + length else { return nil }
            return try? JSONDecoder().decode(DumpHeader.self, from: Data(b[7..<(7 + length)]))
        }
        guard b.count >= 30, u32(b, 0) == 0x0403_4b50, u16(b, 8) == 0 else { return nil }
        let size = u32(b, 18)
        let nameLength = u16(b, 26)
        let start = 30 + nameLength + u16(b, 28)
        guard b.count >= start + size, String(decoding: b[30..<(30 + nameLength)], as: UTF8.self) == "header.json" else {
            return nil
        }
        return try? JSONDecoder().decode(DumpHeader.self, from: Data(b[start..<(start + size)]))
    }

    /// Header of the snapshot in the place; nil when there is none or it cannot be read.
    static func currentHeader(_ dir: BackupDir, base: String = snapshot) throws -> DumpHeader? {
        guard let head = try dir.readHead(base, bytes: headBytes) else { return nil }
        if let header = readHeaderPrefix(head) { return header }
        let whole: Data?
        if head.count < headBytes { whole = head } else { whole = try dir.read(base) }
        guard let whole else { return nil }
        return readHeaderPrefix(whole) ?? (try? Container.open(whole, passphrase: nil).header)
    }

    /// Rotates the previous snapshots by copying, then writes the new one over `base`; a crash
    /// mid-write leaves `base.1` intact. A single file has nowhere to rotate to, and a versioned
    /// drive keeps its own history.
    static func writeSnapshot(_ dir: BackupDir, _ data: Data, appURL: String, base: String = snapshot) throws {
        if dir.single { return try dir.write(base, data) }
        let have = try dir.names()
        if !dir.versioned {
            for step in rotationPlan(have, base) {
                if let bytes = try dir.read(step.from) { try dir.write(step.to, bytes) }
            }
        }
        try dir.write(base, data)
        if !have.contains("README.txt") { try dir.write("README.txt", Data(readme(appURL).utf8)) }
    }

    /// Best effort: every snapshot of this profile, conflict copies from older versions included.
    @discardableResult
    static func deleteSnapshots(_ dir: BackupDir, base: String = snapshot) -> Int {
        var n = 0
        let stem = String(base.dropLast(".hearth".count))
        for name in (try? dir.names()) ?? [] where name == base || name.hasPrefix(base + ".") || name.hasPrefix(stem + ".conflict-") {
            try? dir.remove(name)
            n += 1
        }
        return n
    }

    @discardableResult
    static func removeDir(_ dir: BackupDir, _ name: String) -> Int {
        guard let sub = try? dir.subdir(name, create: false) else { return 0 }
        let n = (try? sub.names().count) ?? 0
        try? dir.remove(name)
        return n
    }

    // MARK: - Sidecars: attached documents and genomes beside the snapshot

    static func sidecarName(_ sha: String) -> String { "\(sha).att" }

    private static func isSidecar(_ name: String) -> Bool {
        name.count == 68 && name.hasSuffix(".att") && name.prefix(64).allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }

    /// Kept small so one automatic backup never sits on the place for minutes (mirror.ts).
    private static let maxFilesPerRun = 25
    private static let maxBytesPerRun = 100 * 1024 * 1024

    /// Copies the attached documents the place does not have yet; returns how many files it holds after.
    static func mirrorAttachments(_ dir: BackupDir, _ repo: Repo, passphrase: String?) throws -> Int {
        let wanted = try repo.db.query("SELECT DISTINCT sha256 FROM attachment ORDER BY sha256").map { $0.text("sha256") }
        if wanted.isEmpty { return 0 }
        guard let sub = try dir.subdir(attachmentsDir, create: true) else { throw DbError(message: "cannot open the attachments folder") }
        let present = try sub.names().filter(isSidecar)
        let have = Set(present.map { String($0.prefix(64)) })
        let sealer = try passphrase.map { try Sealer($0) }
        var written = 0
        var bytes = 0
        for sha in wanted where !have.contains(sha) {
            if written >= maxFilesPerRun || bytes >= maxBytesPerRun { break }
            // Metadata restored on a phone that never had the document: another device will copy it.
            guard let plain = repo.blobs.get(Repo.attachmentBlobName(sha)) else { continue }
            try sub.write(sidecarName(sha), sealer.map { try $0.seal(plain) } ?? plain)
            written += 1
            bytes += plain.count
        }
        return present.count + written
    }

    /// Fetches documents this phone has rows for but not bytes (mirror.ts `pullAttachments`). Each
    /// file is hashed again: the name is a claim about the content, and a folder is something other
    /// programs can write to. Returns (pulled, missing).
    static func pullAttachments(_ dir: BackupDir, _ repo: Repo, passphrase: String?) throws -> (pulled: Int, missing: Int) {
        let shas = try repo.db.query("SELECT DISTINCT sha256 FROM attachment").map { $0.text("sha256") }
        let have = Set(repo.blobs.list())
        let todo = shas.filter { !have.contains(Repo.attachmentBlobName($0)) }
        if todo.isEmpty { return (0, 0) }
        guard let sub = try dir.subdir(attachmentsDir, create: false) else { return (0, todo.count) }
        let opener = passphrase.map { Opener($0) }
        var pulled = 0
        for sha in todo {
            guard let raw = try? sub.read(sidecarName(sha)) else { continue }
            let plain: Data?
            if Sealer.isSealed(raw) { plain = try? opener?.open(raw) } else { plain = raw }
            guard let plain, sha256Hex(plain) == sha else { continue }
            try repo.blobs.put(Repo.attachmentBlobName(sha), plain)
            pulled += 1
        }
        return (pulled, todo.count - pulled)
    }

    /// Writes the genome files the place does not have yet, before the snapshot that names them.
    static func mirrorGenomes(_ dir: BackupDir, _ repo: Repo, _ files: [GenomeFile], passphrase: String?) throws {
        if files.isEmpty { return }
        guard let sub = try dir.subdir(genomesDir, create: true) else { throw DbError(message: "cannot open the genomes folder") }
        let have = Set(try sub.names())
        let todo = files.filter { !have.contains(fileName($0.path)) }
        if todo.isEmpty { return }
        let sealer = try passphrase.map { try Sealer($0) }
        for f in todo {
            guard let bytes = repo.blobs.get(f.blob) else {
                throw DbError(message: "genome file \(f.blob) is missing from this device")
            }
            try sub.write(fileName(f.path), sealer.map { try $0.seal(bytes) } ?? bytes)
        }
    }

    /// Reads genome files back for a restore; the restore checks each against the manifest.
    static func genomeLoader(_ dir: BackupDir, passphrase: String?) -> (GenomeEntry) throws -> Data? {
        let sub = try? dir.subdir(genomesDir, create: false)
        let opener = passphrase.map { Opener($0) }
        return { entry in
            guard let sub, let raw = try sub.read(fileName(entry.path)) else { return nil }
            if !Sealer.isSealed(raw) { return raw }
            guard let opener else { throw BackupError.passphraseRequired }
            return try opener.open(raw)
        }
    }

    private static func fileName(_ path: String) -> String {
        path.split(separator: "/").last.map { String($0) } ?? path
    }
}

/// Sidecar encryption (attachments/crypto.ts): the dump v1 envelope, `HRTH1 | salt | nonce | GCM`.
/// One key per run: the files share a salt and each gets its own nonce.
final class Sealer {
    static let magic = Array("HRTH1".utf8)
    private let salt: [UInt8]
    private let key: SymmetricKey

    static func isSealed(_ data: Data) -> Bool {
        data.count > 33 && Array(data.prefix(5)) == magic
    }

    init(_ passphrase: String) throws {
        salt = SnapshotWriter.randomBytes(16)
        key = try Container.deriveKey(passphrase, salt: salt)
    }

    func seal(_ plain: Data) throws -> Data {
        let nonce = SnapshotWriter.randomBytes(12)
        let box = try AES.GCM.seal(plain, using: key, nonce: AES.GCM.Nonce(data: nonce))
        var out = Data(Sealer.magic)
        out.append(contentsOf: salt)
        out.append(contentsOf: nonce)
        out.append(box.ciphertext)
        out.append(box.tag)
        return out
    }
}

/// Opens sidecars, deriving a key once per salt seen.
final class Opener {
    private let passphrase: String
    private var cached: (salt: [UInt8], key: SymmetricKey)?

    init(_ passphrase: String) {
        self.passphrase = passphrase
    }

    func open(_ data: Data) throws -> Data {
        guard Sealer.isSealed(data) else { throw BackupError.damaged }
        let b = [UInt8](data)
        let salt = Array(b[5..<21])
        let key: SymmetricKey
        if let cached, cached.salt == salt {
            key = cached.key
        } else {
            key = try Container.deriveKey(passphrase, salt: salt)
            cached = (salt, key)
        }
        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: b[21..<33]), ciphertext: b[33..<(b.count - 16)], tag: b[(b.count - 16)...]
            )
            return try AES.GCM.open(box, using: key)
        } catch {
            throw BackupError.wrongPassphrase
        }
    }
}
