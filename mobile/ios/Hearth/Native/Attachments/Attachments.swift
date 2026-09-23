import Foundation

/// What may be attached to a health log entry (frontend/src/attachments/file.ts and store.ts): the
/// types, the limits, how the type is told from the bytes, how a name is made safe to show, and
/// keeping one original with an entry.
enum Attachments {
    static let maxFileBytes = 25 * 1024 * 1024
    static let maxPerEntry = 12
    /// The app's own ceiling for all attachments together (quota.ts `MAX_TOTAL_BYTES`).
    static let maxTotalBytes = 2 * 1024 * 1024 * 1024

    /// Why a file cannot be attached.
    enum Rejection: Error, Equatable {
        case type, size, count, space
    }

    /// The type the bytes actually are, or nil. The picker's type is a guess from the extension, a
    /// hint and never a decision: a renamed executable must not become an "image/png".
    static func sniffMime(_ data: Data) -> String? {
        let b = [UInt8](data.prefix(16))
        guard data.count >= 12 else { return nil }
        func starts(_ at: Int, _ bytes: [UInt8]) -> Bool {
            at + bytes.count <= b.count && Array(b[at..<(at + bytes.count)]) == bytes
        }
        func ascii(_ at: Int, _ s: String) -> Bool { starts(at, Array(s.utf8)) }
        if starts(0, [0xff, 0xd8, 0xff]) { return "image/jpeg" }
        if starts(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) { return "image/png" }
        if ascii(0, "RIFF") && ascii(8, "WEBP") { return "image/webp" }
        if ascii(0, "%PDF-") { return "application/pdf" }
        if ascii(4, "ftyp") {
            // The brand sits at offset 8 of the ISO-BMFF box; HEIF images share the container with video.
            let brand = String(decoding: b[8..<12], as: UTF8.self)
            if ["heic", "heix", "hevc"].contains(brand) { return "image/heic" }
            if ["mif1", "msf1", "heim"].contains(brand) { return "image/heif" }
        }
        return nil
    }

    /// A file name fit to show: control characters and path separators become spaces, runs of
    /// space collapse, at most 120 UTF-16 units as the web slices it. Stored and displayed, never
    /// used to build a path.
    static func safeDisplayName(_ raw: String) -> String {
        var scalars = String.UnicodeScalarView()
        for s in raw.unicodeScalars {
            let control = s.value <= 0x1f || s.value == 0x7f
            scalars.append(control || s == "/" || s == "\\" ? " " : s)
        }
        let collapsed = String(scalars)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let units = Array(collapsed.utf16)
        let cut = units.count > 120 ? String(decoding: units.prefix(120), as: UTF16.self) : collapsed
        return cut.isEmpty ? "document" : cut
    }

    /// Why this file cannot be attached, or nil when it can.
    static func check(size: Int, sniffed: String?, already: Int) -> Rejection? {
        if sniffed == nil { return .type }
        if size > maxFileBytes || size == 0 { return .size }
        if already >= maxPerEntry { return .count }
        return nil
    }

    /// Keeps one original document with an entry (attachments/store.ts). The file is written
    /// before the row, so a failure half way leaves an unreferenced file the next prune collects
    /// rather than a row pointing at nothing. Identical content writes identical bytes under the
    /// same name.
    @discardableResult
    static func add(
        _ repo: Repo, healthLogId: String, personId: String, data: Data, name: String, already: Int
    ) throws -> Attachment {
        let mime = sniffMime(data)
        if let rejection = check(size: data.count, sniffed: mime, already: already) { throw rejection }
        if try repo.attachmentBytesTotal() + data.count > maxTotalBytes { throw Rejection.space }
        let sha = sha256Hex(data)
        let a = Attachment(
            id: newId(), healthLogId: healthLogId, personId: personId, sha256: sha, mime: mime ?? "",
            bytes: data.count, name: safeDisplayName(name), createdAt: nowISO()
        )
        try repo.blobs.put(Repo.attachmentBlobName(sha), data)
        try repo.insertAttachment(a)
        return a
    }

    /// The bytes behind a row, or nil when this phone only has the metadata (restored from a backup).
    static func bytes(_ repo: Repo, _ a: Attachment) -> Data? {
        repo.blobs.get(Repo.attachmentBlobName(a.sha256))
    }

    /// The message for a file that could not be kept (the entry itself is saved).
    static func message(_ error: Error, name: String) -> String {
        switch error as? Rejection {
        case .type?: return t("attachments.badType", ["name": name])
        case .size?: return t("attachments.tooBig", ["name": name, "max": maxFileBytes / 1024 / 1024])
        case .count?: return t("attachments.tooMany", ["max": maxPerEntry])
        case .space?: return t("attachments.noSpace")
        case nil: return t("attachments.saveFailed", ["name": name])
        }
    }
}
