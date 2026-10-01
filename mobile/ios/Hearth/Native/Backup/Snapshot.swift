import CryptoKit
import Foundation

/// A genome a folder snapshot names but keeps beside itself: its path in the manifest, and the blob
/// with its bytes.
struct GenomeFile: Equatable {
    let path: String
    let blob: String
}

/// A dump v2 ready to write (container.ts `Container`): the header, manifest and journal as JSON
/// objects, the genomes it carries, and for a folder backup the genome files that go beside it.
struct Snapshot {
    var header: [String: Any]
    var manifest: [String: Any]
    var journal: [String: Any]
    /// Embedded genomes, by manifest path, in manifest order.
    var genomes: [(path: String, data: Data)]
    var files: [GenomeFile]
}

/// Writing dump v2 (snapshot.ts `buildSnapshot`, container.ts `serialiseContainer`).
enum SnapshotWriter {
    static let magic = Array("HRTH2".utf8)

    static func genomePath(_ sha256OfBytes: String) -> String { "genomes/\(sha256OfBytes).txt.gz" }

    /// A query's rows as JSON objects, SQL types kept (a JSON number for INTEGER and REAL).
    private static func rows(_ db: Db, _ sql: String) throws -> [[String: Any]] {
        try db.query(sql).map { row in row.mapValues(jsonObject) }
    }

    static func jsonObject(_ v: SQLValue) -> Any {
        switch v {
        case .null: return NSNull()
        case .integer(let n): return NSNumber(value: n)
        case .real(let d): return NSNumber(value: d)
        case .text(let s): return s
        }
    }

    /// The sha256 of a cached genome blob, computed once and remembered in meta (bookkeeping, no
    /// generation bump), so a folder snapshot never reads genome bytes again (snapshot.ts `blobSha`).
    private static func blobSha(_ repo: Repo, _ blob: String, _ data: Data?) throws -> String {
        let key = "genome-sha:\(blob)"
        if let known = try repo.getMeta(key) { return known }
        guard let bytes = data ?? repo.blobs.get(blob) else { throw missing(blob) }
        let sha = sha256Hex(bytes)
        try repo.setMeta(key, sha)
        return sha
    }

    private static func missing(_ blob: String) -> Error {
        DbError(message: "genome file \(blob) is missing from this device")
    }

    /// A person's genotypes as the generic provider text (db.worker.ts `genomeText`), for someone
    /// whose original file was not kept. Tab-separated; the header is a comment every parser skips.
    static func genomeText(_ db: Db, _ personId: String) throws -> String {
        var lines = ["# Hearth export: rsid chromosome position genotype (forward strand)"]
        let rows = try db.query(
            "SELECT rsid, chromosome, position, a1 || a2 AS g FROM genotype WHERE person_id = ? ORDER BY chromosome, position",
            [.text(personId)]
        )
        for r in rows {
            lines.append("\(r.text("rsid"))\t\(r.text("chromosome"))\t\(r.int("position") ?? 0)\t\(r.text("g"))")
        }
        return lines.joined(separator: "\n")
    }

    /// The dump v2 container from the live database. Genomes come from the originals kept at
    /// import; a person without one gets a rebuilt generic file, cached under a name that carries
    /// the row count. With `embed` false (the backup folder's form) the manifest lists the genomes
    /// but their bytes travel beside the snapshot as write-once files.
    static func build(_ repo: Repo, appVersion: String, embed: Bool = true) throws -> Snapshot {
        let db = repo.db
        let sourceFiles = try repo.sourceFiles()
        let counts = try repo.genotypeCounts()
        let cached = Set(repo.blobs.list())
        var genomes: [(path: String, data: Data)] = []
        var entries: [[String: Any]] = []
        var files: [GenomeFile] = []

        func add(_ blob: String, _ entry: [String: Any]) throws {
            var data: Data?
            if embed {
                guard let bytes = repo.blobs.get(blob) else { throw missing(blob) }
                data = bytes
            }
            let hash = try blobSha(repo, blob, data)
            let path = genomePath(hash)
            if let data { genomes.append((path, data)) } else { files.append(GenomeFile(path: path, blob: blob)) }
            entries.append(entry.merging(["path": path, "sha256": hash]) { _, new in new })
        }

        for p in try repo.persons() {
            let n = counts[p.id] ?? 0
            if n == 0 { continue }
            let own = sourceFiles.filter { $0.personId == p.id }
            if !own.isEmpty && own.allSatisfy({ cached.contains(Repo.genomeBlobName($0.sha256)) }) {
                for sf in own {
                    try add(Repo.genomeBlobName(sf.sha256), [
                        "person_id": p.id, "source_file_id": sf.id, "provider": sf.provider.rawValue,
                        "build": sf.build, "kind": "original",
                    ])
                }
            } else {
                let name = Repo.rebuiltBlobName(personId: p.id, rows: n)
                if !cached.contains(name) {
                    try repo.blobs.put(name, Gzip.compress(Data(genomeText(db, p.id).utf8)))
                }
                try add(name, [
                    "person_id": p.id, "source_file_id": NSNull(), "provider": "generic",
                    "build": own.first?.build ?? "37", "kind": "reconstructed",
                ])
            }
        }

        let generation = try repo.getMeta("generation") ?? "0"
        let device = try repo.getMeta("device") ?? ""
        let header: [String: Any] = [
            "format": "hearth-dump",
            "version": 2,
            "generation": Int64(generation) ?? 0,
            "device": device,
            "exported_at": nowISO(),
            "encrypted": false,
        ]
        var manifest: [String: Any] = ["app_version": appVersion, "profile": "default", "genomes": entries]
        if !embed { manifest["external_genomes"] = true }
        let consents = try db.query("SELECT kind, version, subject, granted_at FROM consent ORDER BY id DESC").map { r -> [String: Any] in
            [
                "kind": jsonObject(r["kind"] ?? .null), "version": jsonObject(r["version"] ?? .null),
                "subject": jsonObject(r["subject"] ?? .null), "grantedAt": jsonObject(r["granted_at"] ?? .null),
            ]
        }
        let relationships = try repo.relationships().map { ["parentId": $0.parentId, "childId": $0.childId] }
        var journal: [String: Any] = ["relationships": relationships, "consents": consents]
        let tables = [
            ("persons", "SELECT * FROM person"),
            ("source_files", "SELECT * FROM source_file"),
            ("health_log", "SELECT * FROM health_log"),
            ("attachments", "SELECT * FROM attachment"),
            ("notes", "SELECT * FROM note"),
            ("chats", "SELECT * FROM chat"),
            ("sharing_log", "SELECT kind, destination, payload, created_at FROM sharing_log"),
        ]
        for (key, sql) in tables { journal[key] = try rows(db, sql) }
        return Snapshot(header: header, manifest: manifest, journal: journal, genomes: genomes, files: files)
    }

    private static func json(_ object: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    /// Snapshot → bytes. `header.json` goes first and stored, so a folder check can read it from
    /// the first bytes; genomes are already gzipped and are stored too. With a passphrase the zip is
    /// sealed in the `HRTH2` envelope, the header in plain text in front.
    static func serialise(_ s: Snapshot, passphrase: String? = nil) throws -> Data {
        let encrypted = !(passphrase ?? "").isEmpty
        var inner = s.header
        inner["encrypted"] = false
        var zip = ZipWriter()
        try zip.add("header.json", json(inner), deflate: false)
        try zip.add("manifest.json", json(s.manifest), deflate: true)
        try zip.add("journal.json", json(s.journal), deflate: true)
        for g in s.genomes { try zip.add(g.path, g.data, deflate: false) }
        let plain = zip.finish()
        guard let passphrase, encrypted else { return plain }

        var outer = s.header
        outer["encrypted"] = true
        let head = try json(outer)
        guard head.count <= 0xffff else { throw BackupError.damaged }
        let salt = randomBytes(16)
        let nonceBytes = randomBytes(12)
        let nonce = try AES.GCM.Nonce(data: nonceBytes)
        let key = try Container.deriveKey(passphrase, salt: salt)
        let sealed = try AES.GCM.seal(plain, using: key, nonce: nonce)
        var out = Data(magic)
        out.append(contentsOf: [UInt8(head.count >> 8), UInt8(head.count & 0xff)])
        out.append(head)
        out.append(contentsOf: salt)
        out.append(contentsOf: nonceBytes)
        out.append(sealed.ciphertext)
        out.append(sealed.tag)
        return out
    }

    /// The whole snapshot with the genomes inside: the manual export.
    static func bytes(_ repo: Repo, appVersion: String, passphrase: String? = nil) throws -> Data {
        try serialise(build(repo, appVersion: appVersion), passphrase: passphrase)
    }

    static func randomBytes(_ n: Int) -> [UInt8] {
        var g = SystemRandomNumberGenerator()
        return (0..<n).map { _ in UInt8.random(in: .min ... .max, using: &g) }
    }
}
