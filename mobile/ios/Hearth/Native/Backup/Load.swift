import Foundation

/// Loading what the user picked in one go (scheduler.ts `loadFiles`): backup files (a union by id,
/// see Restore.swift) and the genome files a folder snapshot keeps in its `genomes` folder, told
/// apart by content, because a phone's picker selects within one folder only. Genomes that were not
/// among them are remembered in `meta`, so a restart keeps them, until their files are picked.
struct NamedFile {
    let name: String
    let data: Data
}

/// A genome file taken, with whose DNA it was.
struct DnaFrom: Equatable {
    let file: String
    let name: String
}

/// What `Loader.load` brought in, for the message.
struct LoadResult: Equatable {
    /// Backup files among the picked ones; 0 when only genome files were picked.
    var dumps = 0
    var name = ""
    var people = 0
    var genomes = 0
    var exportedAt = ""
    /// Genome files taken, by file name, with whose DNA each was.
    var dna: [DnaFrom] = []
    /// Picked files that were neither a backup nor a genome of anyone on this phone.
    var unused: [String] = []
    /// Sealed files the passphrase did not open.
    var unopened: [String] = []
    /// People the backups listed a genome for that none of the picked files carried.
    var missing: [PersonRef] = []
}

/// A picked file as a possible genome: its gzip bytes and both hashes a manifest may know it by.
struct PickedGenome {
    let gz: Data
    /// sha256 of `gz` (the manifest entry's `sha256`, when the copy is byte for byte).
    let sha256: String
    /// sha256 of the text inside (an original's `source_file` hash).
    let textSha: String
}

enum Loader {
    private static let elsewhereKey = "genomes-elsewhere"

    private static func isZip(_ d: Data) -> Bool {
        d.count > 3 && d[d.startIndex] == 0x50 && d[d.startIndex + 1] == 0x4b && d[d.startIndex + 2] == 3 && d[d.startIndex + 3] == 4
    }

    private static func isGzip(_ d: Data) -> Bool {
        d.count > 1 && d[d.startIndex] == 0x1f && d[d.startIndex + 1] == 0x8b
    }

    /// A file the restore recognises on sight: a dump v2, plain or sealed.
    static func isDumpFile(_ d: Data) -> Bool {
        if Container.isEncrypted(d) { return true }
        guard isZip(d), let reader = try? ZipReader(d), let header = try? reader.read("header.json") else { return false }
        return (try? Container.parseHeader(header)) != nil
    }

    /// Picked files with any .zip opened up: a whole backup folder compressed into one file is one
    /// selection on a phone. From a zip only the current snapshots and the genome files are taken;
    /// rotated copies, conflict files, the README and macOS metadata are left inside. A dump v2 is
    /// a zip too: it is a backup, not a folder of them.
    static func expandArchives(_ files: [NamedFile]) -> [NamedFile] {
        files.flatMap { f -> [NamedFile] in
            guard isZip(f.data), !isDumpFile(f.data), let reader = try? ZipReader(f.data) else { return [f] }
            func base(_ n: String) -> String { String(n.split(separator: "/", omittingEmptySubsequences: true).last ?? "") }
            return reader.files.compactMap { entry -> NamedFile? in
                let n = entry.name
                guard !n.hasSuffix("/"), !n.contains("__MACOSX/"), !base(n).hasPrefix("._") else { return nil }
                let b = base(n)
                guard (b.hasSuffix(".hearth") && !b.contains(".conflict-")) || b.hasSuffix(".gz") else { return nil }
                guard let data = try? reader.read(n) else { return nil }
                return NamedFile(name: b, data: data)
            }
        }
    }

    /// Files the user picked by hand that may be genome files. Sealed ones are opened with the
    /// passphrase. A drive or phone may hand a `.gz` over already decompressed, so plain text counts
    /// too, and is known by the hash of its text. Nil for a file sealed with another passphrase or
    /// that is not text.
    static func readPickedGenomes(_ files: [Data], passphrase: String?) throws -> [PickedGenome?] {
        let opener = passphrase.flatMap { $0.isEmpty ? nil : Opener($0) }
        return try files.map { raw -> PickedGenome? in
            var bytes = raw
            if Sealer.isSealed(raw) {
                guard let opener else { throw BackupError.passphraseRequired }
                guard let opened = try? opener.open(raw) else { return nil }
                bytes = opened
            }
            let compressed = isGzip(bytes)
            let plain: Data
            if compressed {
                guard let inflated = try? Gzip.decompress(bytes) else { return nil }
                plain = inflated
            } else {
                plain = bytes
            }
            let text = GenomeImport.decode(plain)
            let gz = compressed ? bytes : (try? Gzip.compress(Data(text.utf8))) ?? Data()
            return PickedGenome(gz: gz, sha256: sha256Hex(gz), textSha: sha256Hex(text))
        }
    }

    /// Which picked file is the genome `e` waits for: the same bytes, or the same text inside.
    static func pickFor(_ e: Elsewhere, _ picked: [PickedGenome?]) -> Int? {
        picked.firstIndex { p in
            guard let p else { return false }
            return p.sha256 == e.entry.sha256 || (e.textSha != nil && p.textSha == e.textSha)
        }
    }

    // MARK: - What waits for its genome file

    static func elsewhere(_ repo: Repo) -> [Elsewhere] {
        guard let json = try? repo.getMeta(elsewhereKey), let data = json.data(using: .utf8),
              let list = try? JSONDecoder().decode([Stored].self, from: data) else { return [] }
        return list.map { s in
            Elsewhere(
                entry: GenomeEntry(
                    path: s.path, sha256: s.sha256, personId: s.personId, provider: s.provider,
                    original: s.original, sourceFileId: s.sourceFileId
                ),
                name: s.name, textSha: s.textSha
            )
        }
    }

    private static func setElsewhere(_ repo: Repo, _ list: [Elsewhere]) throws {
        if list.isEmpty {
            try repo.db.run("DELETE FROM meta WHERE key = ?", [.text(elsewhereKey)])
            return
        }
        let stored = list.map { x in
            Stored(
                path: x.entry.path, sha256: x.entry.sha256, personId: x.entry.personId, provider: x.entry.provider,
                original: x.entry.original, sourceFileId: x.entry.sourceFileId, name: x.name, textSha: x.textSha
            )
        }
        try repo.setMeta(elsewhereKey, String(decoding: try JSONEncoder().encode(stored), as: UTF8.self))
    }

    private struct Stored: Codable {
        let path: String
        let sha256: String
        let personId: String
        let provider: String
        let original: Bool
        let sourceFileId: String?
        let name: String
        let textSha: String?
    }

    private static func hasGenotypes(_ repo: Repo, _ personId: String) throws -> Bool {
        try !repo.db.query("SELECT 1 AS x FROM genotype WHERE person_id = ? LIMIT 1", [.text(personId)]).isEmpty
    }

    /// People whose genome files a loaded snapshot keeps beside itself and nobody has picked yet.
    static func waiting(_ repo: Repo) -> [PersonRef] {
        elsewhere(repo).filter { !((try? hasGenotypes(repo, $0.entry.personId)) ?? false) }
            .map { PersonRef(id: $0.entry.personId, name: $0.name) }
    }

    // MARK: - Loading

    /// Loads what was picked, in one go. Runs the restore of every backup among the files, then
    /// gives each genome a snapshot left beside itself the picked file that is it. A single file that
    /// is not recognisably a backup is tried as one, so an older dump or a mistake gets the restore's
    /// own message. Slow: call it off the main thread.
    static func load(
        _ repo: Repo, _ files: [NamedFile], passphrase: String?,
        onProgress: ((String, [String: CustomStringConvertible]) -> Void)? = nil
    ) throws -> LoadResult {
        let picked = expandArchives(files)
        let isDump = picked.map { isDumpFile($0.data) }
        var dumps = zip(picked, isDump).filter { $0.1 }.map { $0.0 }
        var rest = zip(picked, isDump).filter { !$0.1 }.map { $0.0 }
        var elsewhere = Loader.elsewhere(repo)
        if dumps.isEmpty && rest.count == 1 && elsewhere.isEmpty {
            dumps = rest
            rest = []
        }
        var out = LoadResult()
        func same(_ a: Elsewhere, _ b: Elsewhere) -> Bool {
            a.entry.personId == b.entry.personId && a.entry.sha256 == b.entry.sha256
        }
        for d in dumps {
            // Genomes beside a folder snapshot come back as `elsewhere`, matched below like any other.
            let r = try Restore.bytes(d.data, passphrase: passphrase.flatMap { $0.isEmpty ? nil : $0 }, into: repo, onProgress: onProgress)
            out.name = d.name
            out.people += r.persons
            out.genomes += r.genomes
            out.exportedAt = r.exportedAt
            out.missing += r.missing
            elsewhere = elsewhere.filter { x in !r.elsewhere.contains { same(x, $0) } } + r.elsewhere
        }
        out.dumps = dumps.count
        let read = try readPickedGenomes(rest.map(\.data), passphrase: passphrase)
        var used = Set<Int>()
        var left: [Elsewhere] = []
        for x in elsewhere {
            guard let at = pickFor(x, read), let g = read[at] else {
                left.append(x)
                continue
            }
            used.insert(at)
            if try !hasGenotypes(repo, x.entry.personId) {
                try repo.db.transaction {
                    try Restore.restoreGenome(repo, x.entry, g.gz, onProgress: onProgress, n: out.dna.count + 1, total: elsewhere.count)
                }
                out.genomes += 1
            }
            out.dna.append(DnaFrom(file: rest[at].name, name: x.name))
        }
        // Nothing listed them (their snapshot was loaded before the list was kept): an original is
        // still known by its source_file row, which has its text's hash.
        var took = Set<String>()
        for (i, g) in read.enumerated() {
            guard let g, !used.contains(i) else { continue }
            guard let sf = try repo.db.query(
                """
                SELECT s.id, s.person_id, s.provider, p.display_name, p.label
                FROM source_file s JOIN person p ON p.id = s.person_id WHERE s.sha256 = ? LIMIT 1
                """,
                [.text(g.textSha)]
            ).first else { continue }
            used.insert(i)
            let personId = sf.text("person_id")
            took.insert(personId)
            if try !hasGenotypes(repo, personId) {
                let entry = GenomeEntry(path: "", sha256: g.sha256, personId: personId, provider: sf.text("provider"), original: true, sourceFileId: sf.text("id"))
                try repo.db.transaction {
                    try Restore.restoreGenome(repo, entry, g.gz, onProgress: onProgress, n: out.dna.count + 1, total: read.count)
                }
                out.genomes += 1
            }
            let who = sf.text("display_name")
            out.dna.append(DnaFrom(file: rest[i].name, name: who.isEmpty ? sf.text("label") : who))
        }
        try setElsewhere(repo, left.filter { !took.contains($0.entry.personId) })
        out.unused = rest.enumerated().filter { !used.contains($0.offset) && read[$0.offset] != nil }.map { $0.element.name }
        out.unopened = rest.enumerated().filter { read[$0.offset] == nil }.map { $0.element.name }
        return out
    }
}
