import Foundation
import zlib

/// Just enough of a zip writer for a Hearth backup (the counterpart of `ZipReader`): each entry
/// stored (method 0) or raw-deflated (method 8), a local header before each, the central directory
/// at the end. No ZIP64, no encryption, no data descriptors: a backup is written whole, in memory,
/// and each entry is far below 4 GB.
struct ZipWriter {
    private struct Entry {
        let name: [UInt8]
        let method: UInt16
        let crc: UInt32
        let compressed: Int
        let size: Int
        let offset: Int
    }

    private var out = Data()
    private var entries: [Entry] = []

    /// 1980-01-01, the earliest DOS date: entries carry no real time, so the same data gives the
    /// same bytes.
    private static let dosDate: UInt16 = (0 << 9) | (1 << 5) | 1

    mutating func add(_ name: String, _ data: Data, deflate: Bool) throws {
        let body = try deflate ? ZipWriter.rawDeflate(data) : data
        let entry = Entry(
            name: Array(name.utf8), method: deflate ? 8 : 0, crc: ZipWriter.crc32(data),
            compressed: body.count, size: data.count, offset: out.count
        )
        guard entry.offset <= Int(UInt32.max), data.count <= Int(UInt32.max) else { throw ZipError.unsupported }
        put32(0x0403_4b50)
        put16(20) // version needed: 2.0
        put16(0) // flags
        put16(entry.method)
        put16(0) // time
        put16(ZipWriter.dosDate)
        put32(entry.crc)
        put32(UInt32(entry.compressed))
        put32(UInt32(entry.size))
        put16(UInt16(entry.name.count))
        put16(0) // extra
        out.append(contentsOf: entry.name)
        out.append(body)
        entries.append(entry)
    }

    /// The finished archive: the entries, then the central directory and its end record.
    mutating func finish() -> Data {
        let directoryStart = out.count
        for e in entries {
            put32(0x0201_4b50)
            put16(20) // made by
            put16(20) // needed
            put16(0)
            put16(e.method)
            put16(0)
            put16(ZipWriter.dosDate)
            put32(e.crc)
            put32(UInt32(e.compressed))
            put32(UInt32(e.size))
            put16(UInt16(e.name.count))
            put16(0) // extra
            put16(0) // comment
            put16(0) // disk
            put16(0) // internal attributes
            put32(0) // external attributes
            put32(UInt32(e.offset))
            out.append(contentsOf: e.name)
        }
        let directorySize = out.count - directoryStart
        put32(0x0605_4b50)
        put16(0)
        put16(0)
        put16(UInt16(entries.count))
        put16(UInt16(entries.count))
        put32(UInt32(directorySize))
        put32(UInt32(directoryStart))
        put16(0) // comment
        return out
    }

    private mutating func put16(_ v: UInt16) {
        out.append(contentsOf: [UInt8(v & 0xff), UInt8(v >> 8)])
    }

    private mutating func put32(_ v: UInt32) {
        put16(UInt16(v & 0xffff))
        put16(UInt16(v >> 16))
    }

    static func crc32(_ data: Data) -> UInt32 {
        data.withUnsafeBytes { raw -> UInt32 in
            guard let base = raw.bindMemory(to: Bytef.self).baseAddress else { return 0 }
            return UInt32(zlib.crc32(0, base, uInt(raw.count)))
        }
    }

    /// Raw deflate (no zlib or gzip wrapper: windowBits -15), as zip stores method 8.
    static func rawDeflate(_ data: Data) throws -> Data {
        var stream = z_stream()
        guard deflateInit2_(&stream, 6, Z_DEFLATED, -15, 8, Z_DEFAULT_STRATEGY,
                            zlibVersion(), Int32(MemoryLayout<z_stream>.size)) == Z_OK
        else { throw ZipError.malformed }
        defer { deflateEnd(&stream) }
        let bound = Int(deflateBound(&stream, uLong(data.count))) + 16
        var input = [UInt8](data)
        var output = [UInt8](repeating: 0, count: bound)
        let rc = input.withUnsafeMutableBufferPointer { src -> Int32 in
            output.withUnsafeMutableBufferPointer { dst -> Int32 in
                stream.next_in = src.baseAddress
                stream.avail_in = uInt(src.count)
                stream.next_out = dst.baseAddress
                stream.avail_out = uInt(dst.count)
                return deflate(&stream, Z_FINISH)
            }
        }
        guard rc == Z_STREAM_END else { throw ZipError.malformed }
        return Data(output[0..<Int(stream.total_out)])
    }
}
