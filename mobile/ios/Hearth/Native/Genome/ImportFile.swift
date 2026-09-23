import CryptoKit
import Foundation

/// Lower-case hex SHA-256, as the web's `sha256Hex` writes it.
func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

/// SHA-256 of a text's UTF-8 bytes: what a source file's `sha256` and a genome blob's name hold.
func sha256Hex(_ text: String) -> String {
    sha256Hex(Data(text.utf8))
}

/// Where an import is: an i18n key from `importFile.json`, its placeholders, and 0–100.
struct ImportProgress {
    let key: String
    var params: [String: CustomStringConvertible] = [:]
    var pct: Double = 0
}

struct ImportSummary: Equatable {
    let calls: Int
    let provider: Provider
    let build: String
    let skipped: Int
}

/// A file that parses to nothing Hearth can store; the message is `importFile.noRows`.
struct NoCallsError: LocalizedError {
    var errorDescription: String? { t("importFile.noRows") }
}

/// A picked file as text, and unpack → parse → store for one person: ports of
/// `frontend/src/import/unpack.ts` and `importFile.ts`. Everything happens on the phone; nothing is
/// uploaded.
enum GenomeImport {
    struct Unpacked: Equatable {
        let text: String
        let innerName: String
    }

    enum Failure: LocalizedError {
        /// A zip with nothing but folders and macOS metadata in it.
        case emptyZip

        var errorDescription: String? { "zip archive contains no files" }
    }

    /// `fileToText`: a .zip gives its largest file (macOS's `__MACOSX` metadata aside), a .gz its
    /// contents, anything else is read as UTF-8.
    static func fileToText(_ data: Data, fileName: String) throws -> Unpacked {
        let name = fileName.lowercased()
        let head = [UInt8](data.prefix(2))
        let isZip = name.hasSuffix(".zip") || head == [0x50, 0x4b]
        let isGz = name.hasSuffix(".gz") || head == [0x1f, 0x8b]
        if isZip {
            let zip = try ZipReader(data)
            // The first of equally large files, in the archive's order, as the Android port picks.
            var largest: ZipReader.File?
            for f in zip.files where !f.name.hasSuffix("/") && !f.name.hasPrefix("__MACOSX") {
                if let l = largest, f.size <= l.size { continue }
                largest = f
            }
            guard let chosen = largest, let bytes = try zip.read(chosen.name) else { throw Failure.emptyZip }
            return Unpacked(text: decode(bytes), innerName: chosen.name)
        }
        if isGz {
            let inner = fileName.replacingOccurrences(of: #"\.gz$"#, with: "", options: [.regularExpression, .caseInsensitive])
            return Unpacked(text: decode(try Gzip.decompress(data)), innerName: inner)
        }
        return Unpacked(text: decode(data), innerName: fileName)
    }

    /// `TextDecoder`'s defaults: UTF-8, malformed bytes replaced, a leading byte-order mark dropped.
    static func decode(_ data: Data) -> String {
        var s = String(decoding: data, as: UTF8.self)
        if s.hasPrefix("\u{FEFF}") { s.removeFirst() }
        return s
    }

    /// `importGenomeFile`, shared by the single and the batch import. Runs for seconds on a real
    /// genome: call it off the main thread (see `Db` on why that is safe). `onProgress` is called on
    /// the calling thread.
    @discardableResult
    static func importFile(
        repo: Repo, personId: String, data: Data, fileName: String, forced: Provider? = nil,
        onProgress: @escaping (ImportProgress) -> Void = { _ in }
    ) throws -> ImportSummary {
        onProgress(ImportProgress(key: "importFile.unpacking"))
        let unpacked = try fileToText(data, fileName: fileName)
        let text = unpacked.text
        let sha256 = sha256Hex(text)
        let detected = forced ?? GenomeParser.detectProvider(text)
        onProgress(ImportProgress(key: "importFile.parsingFile", params: ["name": unpacked.innerName, "provider": detected.label]))
        let r = GenomeParser.parseRawText(text, forced: forced) { done, total in
            onProgress(ImportProgress(key: "importFile.parsing", pct: Double(done) * 50 / Double(max(total, 1))))
        }
        if r.calls.isEmpty { throw NoCallsError() }
        let total = r.calls.count
        onProgress(ImportProgress(key: "importFile.storing", params: ["n": total], pct: 50))
        try repo.importCalls(
            personId: personId, provider: r.provider, build: r.build, sha256: sha256, originalName: fileName,
            calls: r.calls
        ) { n in
            onProgress(ImportProgress(key: "importFile.storingProgress", params: ["n": n, "total": total], pct: 50 + Double(n) * 50 / Double(total)))
        }
        // The original text is kept, gzipped, so backups ship it instead of re-serialising every row.
        try repo.blobs.put(Repo.genomeBlobName(sha256), Gzip.compress(Data(text.utf8)))
        try repo.pruneBlobs()
        return ImportSummary(calls: r.calls.count, provider: r.provider, build: r.build, skipped: r.skipped)
    }

    /// "AncestryDNA (1).txt" → label "ancestrydna-1", display name "AncestryDNA (1)".
    static func personFromFileName(_ name: String) -> (label: String, displayName: String) {
        let stem = name
            .replacingOccurrences(of: #"\.(zip|gz|txt|csv|tsv|vcf)$"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"\.(txt|csv|tsv|vcf)$"#, with: "", options: [.regularExpression, .caseInsensitive])
        let label = stem.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return (label.isEmpty ? "genome" : label, stem.isEmpty ? name : stem)
    }
}
