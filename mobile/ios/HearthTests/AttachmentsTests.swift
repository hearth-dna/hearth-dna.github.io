import XCTest
@testable import Hearth

/// Mirrors frontend/src/attachments/file.test.ts, plus the store (through the Android
/// AttachmentsTest).
final class AttachmentsTests: XCTestCase {
    /// Bytes from integers and ASCII strings, padded with 16 zeros.
    private func bytes(_ parts: Any...) -> Data {
        var out: [UInt8] = []
        for p in parts {
            if let n = p as? Int { out.append(UInt8(truncatingIfNeeded: n)) } else if let s = p as? String { out += Array(s.utf8) }
        }
        return Data(out + [UInt8](repeating: 0, count: 16))
    }

    func testRecognisesTheFormatsWeAcceptAndNothingElse() {
        XCTAssertEqual(Attachments.sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg")
        XCTAssertEqual(Attachments.sniffMime(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a)), "image/png")
        XCTAssertEqual(Attachments.sniffMime(bytes("RIFF", 0, 0, 0, 0, "WEBP")), "image/webp")
        XCTAssertEqual(Attachments.sniffMime(bytes("%PDF-1.7")), "application/pdf")
        XCTAssertEqual(Attachments.sniffMime(bytes(0, 0, 0, 0x18, "ftypheic")), "image/heic")
        XCTAssertEqual(Attachments.sniffMime(bytes(0, 0, 0, 0x18, "ftypmif1")), "image/heif")
        XCTAssertNil(Attachments.sniffMime(bytes("MZ", 0x90, 0)))
        XCTAssertNil(Attachments.sniffMime(bytes("<!DOCTYPE html>")))
        XCTAssertNil(Attachments.sniffMime(bytes(0x50, 0x4b, 0x03, 0x04)))
        XCTAssertNil(Attachments.sniffMime(Data([0xff, 0xd8])))
        XCTAssertNil(Attachments.sniffMime(Data()))
    }

    func testMakesNamesSafeToShow() {
        XCTAssertEqual(Attachments.safeDisplayName("blood-count 2026.pdf"), "blood-count 2026.pdf")
        XCTAssertEqual(Attachments.safeDisplayName("../../etc/passwd"), ".. .. etc passwd")
        XCTAssertEqual(Attachments.safeDisplayName("scan\u{0}\u{1f}.pdf"), "scan .pdf")
        XCTAssertEqual(Attachments.safeDisplayName(String(repeating: "a", count: 300)).count, 120)
        XCTAssertEqual(Attachments.safeDisplayName("   "), "document")
        XCTAssertEqual(Attachments.safeDisplayName("анализ крови.pdf"), "анализ крови.pdf")
    }

    func testChecksSizeAndCount() {
        XCTAssertEqual(Attachments.check(size: 10, sniffed: nil, already: 0), .type)
        XCTAssertEqual(Attachments.check(size: 0, sniffed: "application/pdf", already: 0), .size)
        XCTAssertEqual(Attachments.check(size: Attachments.maxFileBytes + 1, sniffed: "application/pdf", already: 0), .size)
        XCTAssertEqual(Attachments.check(size: 10, sniffed: "application/pdf", already: Attachments.maxPerEntry), .count)
        XCTAssertNil(Attachments.check(size: 10, sniffed: "application/pdf", already: 0))
    }

    func testStoresAFileOnceAndDeletingTheLastRowRemovesIt() throws {
        let repo = try makeTestRepo()
        let p = try repo.addPerson(label: "a", displayName: "A", sex: .unknown, birthYear: nil)
        let e = try repo.addHealthEntry(HealthEntry(
            id: "", personId: p.id, date: "2026-01-01", time: "", kind: .lab, title: "CBC", body: "", source: "",
            bodyPart: "", severity: nil, tags: [], value: nil, value2: nil, unit: "", createdAt: ""
        ))
        let pdf = bytes("%PDF-1.7 hello")
        let a1 = try Attachments.add(repo, healthLogId: e.id, personId: p.id, data: pdf, name: "../cbc.pdf", already: 0)
        let a2 = try Attachments.add(repo, healthLogId: e.id, personId: p.id, data: pdf, name: "copy.pdf", already: 1)
        XCTAssertEqual(a1.name, ".. cbc.pdf")
        XCTAssertEqual(repo.blobs.list(), [Repo.attachmentBlobName(a1.sha256)])
        XCTAssertEqual(try repo.attachmentBytesTotal(), pdf.count)
        XCTAssertThrowsError(try Attachments.add(repo, healthLogId: e.id, personId: p.id, data: bytes("MZ"), name: "x.exe", already: 0)) { error in
            XCTAssertEqual(error as? Attachments.Rejection, .type)
        }
        try repo.deleteAttachment(id: a1.id)
        XCTAssertEqual(repo.blobs.list().count, 1)
        try repo.deleteAttachment(id: a2.id)
        XCTAssertEqual(repo.blobs.list(), [])
        XCTAssertNil(Attachments.bytes(repo, a2))
    }

    func testOrdersMeasurementPresetsByUse() {
        func m(_ title: String) -> HealthEntry {
            HealthEntry(
                id: title, personId: "p", date: "2026-01-01", time: "", kind: .measurement, title: title, body: "",
                source: "", bodyPart: "", severity: nil, tags: [], value: 1, value2: nil, unit: "", createdAt: ""
            )
        }
        let order = HealthPresets.measurementOrder([m("Weight"), m(" blood pressure "), m("Weight"), m("Grip")])
        XCTAssertEqual(order.prefix(2).map(\.id), ["weight", "blood-pressure"])
        XCTAssertEqual(order.count, HealthPresets.measurements.count)
    }
}
