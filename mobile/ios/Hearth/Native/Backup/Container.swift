import CommonCrypto
import CryptoKit
import Foundation

/// Any JSON value, as the journal holds them: rows are objects of column name to value, decoded
/// without a schema so that restore can take exactly the columns it allows and ignore the rest.
enum JSONValue: Decodable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let b = try? container.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? container.decode(Double.self) {
            self = .number(n)
        } else if let s = try? container.decode(String.self) {
            self = .string(s)
        } else if let a = try? container.decode([JSONValue].self) {
            self = .array(a)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    /// JavaScript truthiness, for the checks restore.ts writes as `if (c.revokedAt)`.
    var isTruthy: Bool {
        switch self {
        case .null: return false
        case .bool(let b): return b
        case .number(let n): return n != 0 && !n.isNaN
        case .string(let s): return !s.isEmpty
        case .array, .object: return true
        }
    }
}

/// One row of the journal.
typealias JSONRow = [String: JSONValue]

/// Why a file could not be opened. Each case is something the user can act on, and the screens
/// say so in those terms.
enum BackupError: Error, Equatable {
    /// Not a dump v2 at all: another file, an older (v1) dump, or a portable .html archive.
    case notABackup
    /// Encrypted, and no passphrase was given.
    case passphraseRequired
    /// Encrypted, and the passphrase does not open it (or the ciphertext was altered: AES-GCM
    /// cannot tell the two apart, and neither can the user).
    case wrongPassphrase
    /// A dump v2 whose contents are broken: a missing entry, bad JSON, a genome that fails its hash.
    case damaged
}

/// An opened dump v2: what restore needs from `frontend/src/export/container.ts`'s `Container`.
struct Dump {
    let exportedAt: String
    let encrypted: Bool
    /// `journal.json`: table name → rows.
    let journal: [String: JSONValue]
    /// The genomes the manifest lists (`GenomeEntry` in container.ts).
    let genomes: [GenomeEntry]
    /// The gzipped genome files the zip carries, by manifest path, each checked against the
    /// manifest's sha256. A folder backup's may be absent (`external_genomes`).
    let genomeFiles: [String: Data]

    /// The rows under `key`; none when the journal has no such key (older files have no
    /// `attachments`). An element that is not an object is a damaged file.
    func rows(_ key: String) throws -> [JSONRow] {
        guard let value = journal[key] else { return [] }
        guard case .array(let items) = value else { throw BackupError.damaged }
        return try items.map { item in
            guard case .object(let row) = item else { throw BackupError.damaged }
            return row
        }
    }
}

/// One genome the manifest lists: where its file is, whose it is, and whether it is the file as
/// imported (`original`, parsed with its provider's parser) or rebuilt as generic text.
struct GenomeEntry: Equatable {
    let path: String
    let sha256: String
    let personId: String
    let provider: String
    let original: Bool
}

/// Opens a dump v2 file (docs/architecture/storage/dump-v2.md):
///
/// - plain: a zip holding `header.json`, `manifest.json`, `journal.json` and genome entries;
/// - encrypted: `HRTH2`, a 2-byte big-endian header length, the plaintext header JSON, a 16-byte
///   salt, a 12-byte nonce, then AES-256-GCM of the zip with the 16-byte tag at its end. The key is
///   PBKDF2-HMAC-SHA256 of the UTF-8 passphrase, 600 000 iterations.
///
/// The cryptography is Apple's (CommonCrypto, CryptoKit); nothing here implements a cipher.
enum Container {
    private static let magic = Array("HRTH2".utf8)
    private static let iterations: UInt32 = 600_000

    /// Whether the file is in the encrypted envelope, so the screen knows to ask for a passphrase
    /// before trying.
    static func isEncrypted(_ data: Data) -> Bool {
        data.count >= magic.count && Array(data.prefix(magic.count)) == magic
    }

    /// Opens the file. Slow when encrypted (the key derivation is deliberately expensive): call it
    /// off the main thread.
    static func open(_ data: Data, passphrase: String?) throws -> Dump {
        let bytes = [UInt8](data)
        let encrypted = isEncrypted(data)
        var zip = bytes
        if encrypted {
            zip = try decrypt(bytes, passphrase: passphrase)
        }
        guard zip.count >= 2, zip[0] == 0x50, zip[1] == 0x4b else { throw BackupError.notABackup }

        let reader: ZipReader
        do {
            reader = try ZipReader(Data(zip))
        } catch {
            throw BackupError.damaged
        }
        guard let headerBytes = try entry(reader, "header.json") else { throw BackupError.notABackup }
        let header = try parseHeader(headerBytes)
        guard let manifestBytes = try entry(reader, "manifest.json"),
              let journalBytes = try entry(reader, "journal.json")
        else { throw BackupError.damaged }
        let manifest: Manifest
        let journal: [String: JSONValue]
        do {
            manifest = try JSONDecoder().decode(Manifest.self, from: manifestBytes)
            journal = try JSONDecoder().decode([String: JSONValue].self, from: journalBytes)
        } catch {
            throw BackupError.damaged
        }
        // A missing or altered genome refuses the whole file before anything is restored, as on
        // the web: half a family is worse than an error the user can act on.
        var genomeFiles: [String: Data] = [:]
        for genome in manifest.genomes {
            guard let file = try entry(reader, genome.path) else {
                if manifest.externalGenomes == true { continue }
                throw BackupError.damaged
            }
            guard sha256Hex(file) == genome.sha256 else { throw BackupError.damaged }
            genomeFiles[genome.path] = file
        }
        return Dump(
            exportedAt: header.exportedAt ?? "",
            encrypted: encrypted,
            journal: journal,
            genomes: manifest.genomes.map { g in
                GenomeEntry(
                    path: g.path, sha256: g.sha256, personId: g.personId, provider: g.provider ?? "generic",
                    original: g.kind == "original"
                )
            },
            genomeFiles: genomeFiles
        )
    }

    // MARK: - Private

    private struct Header: Decodable {
        let format: String
        let version: Int
        let exportedAt: String?

        enum CodingKeys: String, CodingKey {
            case format, version
            case exportedAt = "exported_at"
        }
    }

    private struct Manifest: Decodable {
        struct Genome: Decodable {
            let path: String
            let sha256: String
            let personId: String
            let provider: String?
            let kind: String?

            enum CodingKeys: String, CodingKey {
                case path, sha256, provider, kind
                case personId = "person_id"
            }
        }

        let genomes: [Genome]
        let externalGenomes: Bool?

        enum CodingKeys: String, CodingKey {
            case genomes
            case externalGenomes = "external_genomes"
        }
    }

    private static func parseHeader(_ data: Data) throws -> Header {
        guard let header = try? JSONDecoder().decode(Header.self, from: data),
              header.format == "hearth-dump", header.version == 2
        else { throw BackupError.notABackup }
        return header
    }

    private static func entry(_ reader: ZipReader, _ name: String) throws -> Data? {
        do {
            return try reader.read(name)
        } catch {
            throw BackupError.damaged
        }
    }

    private static func decrypt(_ bytes: [UInt8], passphrase: String?) throws -> [UInt8] {
        let lengthAt = magic.count
        guard bytes.count >= lengthAt + 2 else { throw BackupError.damaged }
        let headerLength = Int(bytes[lengthAt]) << 8 | Int(bytes[lengthAt + 1])
        let headerStart = lengthAt + 2
        let saltStart = headerStart + headerLength
        let nonceStart = saltStart + 16
        let cipherStart = nonceStart + 12
        // At least the 16-byte tag after the nonce.
        guard bytes.count >= cipherStart + 16 else { throw BackupError.damaged }
        // The plaintext header must itself be a dump v2 header: the same check the web's
        // readHeader makes before it asks for a passphrase.
        _ = try parseHeader(Data(bytes[headerStart..<saltStart]))
        guard let passphrase, !passphrase.isEmpty else { throw BackupError.passphraseRequired }

        let key = try deriveKey(passphrase, salt: Array(bytes[saltStart..<nonceStart]))
        let tagStart = bytes.count - 16
        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: bytes[nonceStart..<cipherStart]),
                ciphertext: bytes[cipherStart..<tagStart],
                tag: bytes[tagStart...]
            )
            return Array(try AES.GCM.open(box, using: key))
        } catch {
            throw BackupError.wrongPassphrase
        }
    }

    /// WebCrypto's `deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations }, …, AES-GCM 256)`:
    /// the passphrase's UTF-8 bytes, unnormalised, as `TextEncoder` gives them.
    private static func deriveKey(_ passphrase: String, salt: [UInt8]) throws -> SymmetricKey {
        let password = Array(passphrase.utf8)
        var derived = [UInt8](repeating: 0, count: 32)
        let status = password.withUnsafeBufferPointer { pw -> Int32 in
            salt.withUnsafeBufferPointer { saltBuffer -> Int32 in
                derived.withUnsafeMutableBufferPointer { out -> Int32 in
                    guard let base = pw.baseAddress else { return Int32(kCCParamError) }
                    return base.withMemoryRebound(to: CChar.self, capacity: pw.count) { chars in
                        CCKeyDerivationPBKDF(
                            CCPBKDFAlgorithm(kCCPBKDF2),
                            chars, pw.count,
                            saltBuffer.baseAddress, saltBuffer.count,
                            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                            iterations,
                            out.baseAddress, out.count
                        )
                    }
                }
            }
        }
        guard status == Int32(kCCSuccess) else { throw BackupError.wrongPassphrase }
        return SymmetricKey(data: derived)
    }
}
