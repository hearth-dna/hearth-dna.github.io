import XCTest
@testable import Hearth

/// Mirrors frontend/src/ask/assistants.test.ts (through the Android AssistantsTest).
final class AssistantsTests: XCTestCase {
    private func by(_ id: String) -> Assistant { Assistants.all.first { $0.id == id }! }

    func testPutsTheTextEncodedInEachProvidersPrefillParameter() throws {
        let text = "Person A: CYP2C19 *2/*2 & clopidogrel?\nПочему? (ok) it's ~fine!"
        for a in Assistants.all {
            let url = try XCTUnwrap(Assistants.url(a, text), a.id)
            XCTAssertEqual(url.scheme, "https", a.id)
            let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
            XCTAssertEqual(items.last { $0.name == "q" }?.value, text, a.id)
        }
        XCTAssertEqual(Assistants.url(by("google"), "x")?.absoluteString, "https://www.google.com/search?udm=50&q=x")
        XCTAssertEqual(Assistants.url(by("claude"), "x")?.absoluteString, "https://claude.ai/new?q=x")
    }

    func testEncodesLikeEncodeURIComponent() {
        XCTAssertEqual(Assistants.encodeURIComponent("a b&c!'()*~-_."), "a%20b%26c!'()*~-_.")
        XCTAssertEqual(Assistants.encodeURIComponent("ж"), "%D0%B6")
    }

    func testRefusesATextTooLongForAnAddress() {
        XCTAssertNil(Assistants.url(by("chatgpt"), String(repeating: "a", count: Assistants.maxURL)))
        XCTAssertNotNil(Assistants.url(by("chatgpt"), String(repeating: "a", count: Assistants.maxURL - 100)))
    }
}
