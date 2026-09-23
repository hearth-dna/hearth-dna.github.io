import XCTest
@testable import Hearth

/// Mirrors frontend/src/documents/draft.test.ts (through the Android DraftTest).
final class DraftTests: XCTestCase {
    func testFoldsLabValuesIntoTheBody() throws {
        let d = try DocumentDraft.fromJSON(
            #"{"date":"2026-05-01","kind":"lab","title":"Lipid panel","body":"Fasting sample.","values":[{"name":"LDL","value":"4.1","unit":"mmol/L","ref":"< 3.0"},{"name":"HDL","value":"1.2"}]}"#,
            fallbackDate: "2026-09-13"
        )
        XCTAssertEqual(d, HealthDraft(
            date: "2026-05-01", kind: .lab, title: "Lipid panel",
            body: "Fasting sample.\n\nLDL: 4.1 mmol/L (ref < 3.0)\nHDL: 1.2"
        ))
    }

    func testFallsBackOnBadDateUnknownKindAndEmptyTitle() throws {
        XCTAssertEqual(
            try DocumentDraft.fromJSON(#"{"date":"May 2026","kind":"xray","title":"","body":"ok","values":[]}"#, fallbackDate: "2026-09-13"),
            HealthDraft(date: "2026-09-13", kind: .other, title: "Untitled document", body: "ok")
        )
    }

    func testAsksForTranscriptionOnly() {
        let p = DocumentDraft.prompt("imaging")
        XCTAssertTrue(p.contains("imaging report"))
        XCTAssertTrue(p.contains("Do not add interpretation"))
        XCTAssertTrue(p.contains("Leave out patient name"))
    }

    func testTheSchemaIsValidJSON() throws {
        let data = try JSONSerialization.data(withJSONObject: DocumentDraft.schema())
        let back = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(back["required"] as? [String], ["date", "kind", "title", "body", "values"])
    }
}
