import Compression
import Foundation

enum ZipError: Error {
    /// The bytes are not a well-formed zip: a header points outside the file, a signature is
    /// wrong, or a compressed entry does not inflate to its recorded size.
    case malformed
    /// A zip feature the web app never writes: encryption, ZIP64, or a method other than stored
    /// and deflate.
    case unsupported
}

/// Just enough of a zip reader for a Hearth backup (the web writes it with fflate's `zipSync`):
/// the central directory, then each entry through its local header, stored (method 0) or deflated
/// (method 8). There is no writer and no streaming; a backup is read whole.
///
/// Every offset comes from the file, so every read is bounds-checked and throws instead of
/// trapping: a damaged backup is an error message, never a crash.
struct ZipReader {
    private struct Entry {
        let flags: Int
        let method: Int
        let compressedSize: Int
        let size: Int
        let localHeader: Int
    }

    /// Refuses to inflate an entry larger than this. A journal is text and a genome is stored, not
    /// deflated, so a real backup stays far below it; a crafted "zip bomb" does not.
    private static let maxInflated = 1 << 30

    private let bytes: [UInt8]
    private let entries: [String: Entry]

    init(_ data: Data) throws {
        let bytes = [UInt8](data)
        let end = try ZipReader.endOfCentralDirectory(bytes)
        let count = try ZipReader.u16(bytes, end + 10)
        let directorySize = try ZipReader.u32(bytes, end + 12)
        let directoryStart = try ZipReader.u32(bytes, end + 16)
        if count == 0xffff || directorySize == 0xffff_ffff || directoryStart == 0xffff_ffff {
            throw ZipError.unsupported
        }
        guard directoryStart + directorySize <= end else { throw ZipError.malformed }

        var entries: [String: Entry] = [:]
        var p = directoryStart
        for _ in 0..<count {
            guard try ZipReader.u32(bytes, p) == 0x0201_4b50 else { throw ZipError.malformed }
            let nameLength = try ZipReader.u16(bytes, p + 28)
            let extraLength = try ZipReader.u16(bytes, p + 30)
            let commentLength = try ZipReader.u16(bytes, p + 32)
            let nameEnd = p + 46 + nameLength
            guard nameEnd <= bytes.count else { throw ZipError.malformed }
            let name = String(decoding: bytes[(p + 46)..<nameEnd], as: UTF8.self)
            let entry = try Entry(
                flags: ZipReader.u16(bytes, p + 8),
                method: ZipReader.u16(bytes, p + 10),
                compressedSize: ZipReader.u32(bytes, p + 20),
                size: ZipReader.u32(bytes, p + 24),
                localHeader: ZipReader.u32(bytes, p + 42)
            )
            // The first of two same-named entries wins; the web never writes two.
            if entries[name] == nil { entries[name] = entry }
            p = nameEnd + extraLength + commentLength
        }
        self.bytes = bytes
        self.entries = entries
    }

    /// The bytes of the entry called `name`, or nil when the zip has no such entry.
    func read(_ name: String) throws -> Data? {
        guard let entry = entries[name] else { return nil }
        // Bit 0: encrypted with zip's own scheme, which Hearth never uses (it wraps the whole zip).
        if entry.flags & 1 != 0 { throw ZipError.unsupported }
        let at = entry.localHeader
        guard try ZipReader.u32(bytes, at) == 0x0403_4b50 else { throw ZipError.malformed }
        // The sizes come from the central directory: a local header may carry zeros and put the
        // real sizes in a trailing data descriptor.
        let nameLength = try ZipReader.u16(bytes, at + 26)
        let extraLength = try ZipReader.u16(bytes, at + 28)
        let start = at + 30 + nameLength + extraLength
        let end = start + entry.compressedSize
        guard end <= bytes.count else { throw ZipError.malformed }
        let body = bytes[start..<end]
        switch entry.method {
        case 0:
            guard entry.size == entry.compressedSize else { throw ZipError.malformed }
            return Data(body)
        case 8:
            return try ZipReader.inflate(body, size: entry.size)
        default:
            throw ZipError.unsupported
        }
    }

    /// Raw deflate (RFC 1951), which is what Compression's COMPRESSION_ZLIB decodes: no zlib
    /// header, exactly as zip stores it. The output buffer has one byte to spare, so an entry that
    /// inflates to more than its recorded size is caught rather than silently cut short.
    private static func inflate(_ body: ArraySlice<UInt8>, size: Int) throws -> Data {
        if size == 0 { return Data() }
        guard size <= maxInflated else { throw ZipError.unsupported }
        let source = Array(body)
        var output = [UInt8](repeating: 0, count: size + 1)
        let written = source.withUnsafeBufferPointer { src -> Int in
            output.withUnsafeMutableBufferPointer { dst -> Int in
                guard let from = src.baseAddress, let to = dst.baseAddress else { return 0 }
                return compression_decode_buffer(to, dst.count, from, src.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written == size else { throw ZipError.malformed }
        return Data(output[0..<size])
    }

    /// The end-of-central-directory record: the last 22 bytes of the file, or further back when the
    /// zip carries a comment (at most 65535 bytes of one).
    private static func endOfCentralDirectory(_ bytes: [UInt8]) throws -> Int {
        guard bytes.count >= 22 else { throw ZipError.malformed }
        var p = bytes.count - 22
        let lowest = max(0, p - 0xffff)
        while p >= lowest {
            if bytes[p] == 0x50 && bytes[p + 1] == 0x4b && bytes[p + 2] == 0x05 && bytes[p + 3] == 0x06 {
                return p
            }
            p -= 1
        }
        throw ZipError.malformed
    }

    private static func u16(_ bytes: [UInt8], _ at: Int) throws -> Int {
        guard at >= 0, at + 2 <= bytes.count else { throw ZipError.malformed }
        return Int(bytes[at]) | Int(bytes[at + 1]) << 8
    }

    private static func u32(_ bytes: [UInt8], _ at: Int) throws -> Int {
        guard at >= 0, at + 4 <= bytes.count else { throw ZipError.malformed }
        return Int(bytes[at]) | Int(bytes[at + 1]) << 8 | Int(bytes[at + 2]) << 16 | Int(bytes[at + 3]) << 24
    }
}
