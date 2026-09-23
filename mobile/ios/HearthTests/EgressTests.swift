import XCTest
@testable import Hearth

/// Mirrors frontend/src/egress/egress.test.ts (through the Android EgressTest): one gateway, and it
/// refuses what it must.
final class EgressTests: XCTestCase {
    private static let appSources = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // HearthTests
        .deletingLastPathComponent() // ios
        .appendingPathComponent("Hearth")

    /// Anything that can open a connection; only Egress.swift may name these. The system sign-in
    /// sheet (ASWebAuthenticationSession) is not our connection and is allowed.
    private static let network = try! NSRegularExpression(pattern: #"URLSession|NSURLConnection|dataTask|URLRequest\("#)

    /// Files allowed to match besides Egress.swift.
    private static let allowed: Set<String> = [
        "Egress.swift",
        // The web-view shell, whose WKWebView loads its local page with a URLRequest:
        // deleted at cutover (Phase 8).
        "WebAppView.swift",
    ]

    func testNothingButEgressOpensAConnection() throws {
        let files = try XCTUnwrap(FileManager.default.enumerator(at: EgressTests.appSources, includingPropertiesForKeys: nil))
        var scanned = 0
        var offenders: [String] = []
        for case let url as URL in files where url.pathExtension == "swift" {
            scanned += 1
            if EgressTests.allowed.contains(url.lastPathComponent) { continue }
            let text = try String(contentsOf: url)
            let range = NSRange(location: 0, length: (text as NSString).length)
            if EgressTests.network.firstMatch(in: text, range: range) != nil { offenders.append(url.lastPathComponent) }
        }
        XCTAssertGreaterThan(scanned, 20, "the scan found the sources")
        XCTAssertEqual(offenders, [])
    }

    func testRefusesOtherHostsAndPlainHTTP() {
        XCTAssertThrowsError(try Egress.check(URL(string: "https://evil.example/x")!))
        XCTAssertThrowsError(try Egress.check(URL(string: "http://www.googleapis.com/x")!))
        XCTAssertNoThrow(try Egress.check(URL(string: "https://www.googleapis.com/drive/v3/files")!))
        let refused = expectation(description: "refused before sending")
        Egress.request("GET", URL(string: "https://evil.example/x")!) { result in
            if case .failure(let error) = result, error as? Egress.Failure == .refused("evil.example") { refused.fulfill() }
        }
        wait(for: [refused], timeout: 1)
    }

    func testRefusesUnconfirmedSendsAndMissingKeys() async {
        do {
            _ = try await Egress.readDocumentWithGemini(key: "k", model: nil, parts: [], prompt: "p", schema: [:], confirmedAt: nil)
            XCTFail("sent without a confirmation")
        } catch {
            XCTAssertEqual(error as? Egress.Failure, .unconfirmed)
        }
        do {
            _ = try await Egress.readDocumentWithGemini(key: "", model: nil, parts: [], prompt: "p", schema: [:], confirmedAt: "now")
            XCTFail("sent without a key")
        } catch {
            XCTAssertEqual(error as? Egress.Failure, .noKey)
        }
    }
}
