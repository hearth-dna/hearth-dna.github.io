import Foundation
import zlib

/// gzip through the system's zlib (`libz`), which iOS ships but no Swift API wraps. The
/// Compression framework only speaks raw deflate (what `ZipReader` uses), and a gzip member needs
/// its header and CRC as well, so zlib does both directions here.
enum Gzip {
    enum Failure: Error {
        /// Not gzip or zlib data, or cut short.
        case malformed
    }

    /// One gzip member at the default level, as `CompressionStream('gzip')` and Java's
    /// `GZIPOutputStream` write it.
    static func compress(_ data: Data) throws -> Data {
        var stream = z_stream()
        // windowBits 15 + 16: a gzip wrapper instead of zlib's. Level 6 is Z_DEFAULT_COMPRESSION's.
        guard deflateInit2_(&stream, 6, Z_DEFLATED, 15 + 16, 8, Z_DEFAULT_STRATEGY,
                            zlibVersion(), Int32(MemoryLayout<z_stream>.size)) == Z_OK
        else { throw Failure.malformed }
        defer { deflateEnd(&stream) }
        // deflateBound counts the gzip header and trailer too; the margin is for its empty-input case.
        let bound = Int(deflateBound(&stream, uLong(data.count))) + 64
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
        guard rc == Z_STREAM_END else { throw Failure.malformed }
        return Data(output[0..<Int(stream.total_out)])
    }

    /// gzip or zlib data back to its bytes (windowBits 15 + 32 detects which). Consecutive gzip
    /// members are joined, as `gunzip` and Java's `GZIPInputStream` join them.
    static func decompress(_ data: Data) throws -> Data {
        var stream = z_stream()
        guard inflateInit2_(&stream, 15 + 32, zlibVersion(), Int32(MemoryLayout<z_stream>.size)) == Z_OK
        else { throw Failure.malformed }
        defer { inflateEnd(&stream) }
        let chunk = 1 << 16
        var input = [UInt8](data)
        var buffer = [UInt8](repeating: 0, count: chunk)
        var output = Data()
        output.reserveCapacity(data.count * 4)
        try input.withUnsafeMutableBufferPointer { src in
            stream.next_in = src.baseAddress
            stream.avail_in = uInt(src.count)
            while true {
                let rc = buffer.withUnsafeMutableBufferPointer { dst -> Int32 in
                    stream.next_out = dst.baseAddress
                    stream.avail_out = uInt(dst.count)
                    return inflate(&stream, Z_NO_FLUSH)
                }
                output.append(contentsOf: buffer[0..<(chunk - Int(stream.avail_out))])
                if rc == Z_STREAM_END {
                    // Another member follows only when the next bytes are a gzip header; anything
                    // else (padding) ends the data, as it does for gunzip.
                    let left = Int(stream.avail_in)
                    guard left >= 2, let next = stream.next_in, next[0] == 0x1f, next[1] == 0x8b else { return }
                    guard inflateReset(&stream) == Z_OK else { throw Failure.malformed }
                    continue
                }
                // Z_BUF_ERROR here means no progress was possible: the input ended mid-stream.
                guard rc == Z_OK else { throw Failure.malformed }
            }
        }
        return output
    }
}
