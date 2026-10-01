import CryptoKit
import Foundation

/// Dump v1, the format before dump v2 (export/dump.ts): one gzipped JSON document, optionally after
/// `HRTH1` + 16-byte salt + 12-byte nonce + AES-GCM. Genotypes are a string table over a shared SNP
/// index, two characters per SNP per person. Read only: the app writes v2.
enum DumpV1 {
    private static let magic = Array("HRTH1".utf8)

    /// A v1 dump sealed with a passphrase.
    static func isSealed(_ data: Data) -> Bool {
        data.count > 5 && Array(data.prefix(5)) == magic
    }

    static func isV1(_ data: Data) -> Bool {
        isSealed(data) || (data.count > 2 && data[data.startIndex] == 0x1f && data[data.startIndex + 1] == 0x8b)
    }

    /// The v1 document, decrypted and inflated.
    static func open(_ data: Data, passphrase: String?) throws -> [String: Any] {
        var gz = data
        if isSealed(data) {
            guard let passphrase, !passphrase.isEmpty else { throw BackupError.passphraseRequired }
            let bytes = [UInt8](data)
            guard bytes.count >= 33 + 16 else { throw BackupError.damaged }
            let key = try Container.deriveKey(passphrase, salt: Array(bytes[5..<21]))
            do {
                let box = try AES.GCM.SealedBox(
                    nonce: AES.GCM.Nonce(data: bytes[21..<33]),
                    ciphertext: bytes[33..<(bytes.count - 16)],
                    tag: bytes[(bytes.count - 16)...]
                )
                gz = try AES.GCM.open(box, using: key)
            } catch {
                throw BackupError.wrongPassphrase
            }
        }
        let document: [String: Any]
        do {
            let text = GenomeImport.decode(try Gzip.decompress(gz))
            guard let d = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else {
                throw BackupError.damaged
            }
            document = d
        } catch {
            throw BackupError.damaged
        }
        guard document["format"] as? String == "hearth-dump", (document["version"] as? NSNumber)?.intValue == 1 else {
            throw BackupError.notABackup
        }
        return document
    }

    /// personId → calls, from the shared SNP index (dump.ts `expandDump`); "--" is no call.
    static func expand(_ d: [String: Any]) -> [String: [Call]] {
        guard let index = d["snp_index"] as? [String: Any],
              let rsids = index["rsids"] as? [String],
              let chromosomes = index["chromosomes"] as? [String],
              let positions = index["positions"] as? [NSNumber],
              let genotypes = d["genotypes"] as? [String: String]
        else { return [:] }
        var out: [String: [Call]] = [:]
        for (personId, s) in genotypes {
            let chars = Array(s)
            var calls: [Call] = []
            for i in rsids.indices where i * 2 + 1 < chars.count && i < chromosomes.count && i < positions.count {
                let a1 = String(chars[i * 2])
                let a2 = String(chars[i * 2 + 1])
                if a1 == "-" && a2 == "-" { continue }
                calls.append(Call(rsid: rsids[i], chromosome: chromosomes[i], position: positions[i].intValue, a1: a1, a2: a2))
            }
            out[personId] = calls
        }
        return out
    }

    private static func string(_ o: [String: Any], _ key: String, _ fallback: String = "") -> String {
        (o[key] as? String) ?? fallback
    }

    /// A v1 dump merged in (restore.ts `restoreV1`): people not here yet with their genotypes, the
    /// links, their health entries, the consents. People already here are left alone.
    static func restore(_ d: [String: Any], into repo: Repo) throws -> RestoreResult {
        try repo.db.transaction { () throws -> RestoreResult in
            let calls = expand(d)
            let existing = try Set(repo.persons().map(\.id))
            var added = Set<String>()
            let sourceFiles = d["source_files"] as? [[String: Any]] ?? []
            let healthBefore = try repo.healthLog().count
            for p in d["persons"] as? [[String: Any]] ?? [] {
                let id = string(p, "id")
                if id.isEmpty || existing.contains(id) { continue }
                added.insert(id)
                let birthYear = (p["birthYear"] as? NSNumber).map { SQLValue.integer($0.int64Value) } ?? .null
                try repo.db.run(
                    "INSERT INTO person(id,label,display_name,sex,birth_year,notes,created_at) VALUES (?,?,?,?,?,?,?)",
                    [
                        .text(id), .text(string(p, "label")), .text(string(p, "displayName")),
                        .text(string(p, "sex", "unknown")), birthYear, .text(string(p, "notes")), .text(string(p, "createdAt")),
                    ]
                )
                let sf = sourceFiles.first { string($0, "personId") == id }
                try repo.importCalls(
                    personId: id,
                    provider: Provider.of(sf.map { string($0, "provider", "generic") } ?? "generic"),
                    build: sf.map { string($0, "build") }.flatMap { $0.isEmpty ? nil : $0 } ?? "37",
                    sha256: sf.map { string($0, "sha256") } ?? "",
                    originalName: sf.map { string($0, "originalName") }.flatMap { $0.isEmpty ? nil : $0 } ?? "dump-v1",
                    calls: calls[id] ?? []
                )
            }
            for r in d["relationships"] as? [[String: Any]] ?? [] {
                try repo.setParent(parentId: string(r, "parentId"), childId: string(r, "childId"))
            }
            // Health rows and consents go through the v2 merge, with its allowlists and defaults.
            let health = (d["health_log"] as? [[String: Any]] ?? []).filter { added.contains(string($0, "person_id")) }
            let partial: [String: Any] = ["health_log": health, "consents": d["consents"] as? [Any] ?? []]
            let journal = try JSONDecoder().decode(
                [String: JSONValue].self, from: JSONSerialization.data(withJSONObject: partial)
            )
            let exportedAt = string(d, "exported_at")
            let header = DumpHeader(format: "hearth-dump", version: 1, exportedAt: exportedAt, device: nil, generation: nil, encrypted: false)
            _ = try Restore.run(
                Dump(header: header, exportedAt: exportedAt, encrypted: false, journal: journal, genomes: [], genomeFiles: [:]),
                into: repo
            )
            let healthAfter = try repo.healthLog().count
            return RestoreResult(
                persons: added.count, healthEntries: healthAfter - healthBefore, genomes: added.count,
                skippedAttachmentFiles: 0, exportedAt: exportedAt
            )
        }
    }
}
