import XCTest
@testable import Hearth

/// The open formats come out as the web writes them (export/table.ts): the expected strings are
/// what `toCsv` and `toJsonl` produce for the same table.
final class OpenFormatsTests: XCTestCase {
    private let table = Table(
        header: ["name", "value", "note"],
        rows: [
            [.text("Alex"), .number(128), .text("plain")],
            [.text("Sam, jr"), .number(37.8), .text("says \"hi\"\nthen goes")],
            [.text(" padded"), .null, .text("tab\there\u{1}")],
        ]
    )

    func testCSVQuotesLikeRFC4180WithABOM() {
        XCTAssertEqual(
            OpenFormats.render(table, .csv),
            "\u{FEFF}name,value,note\nAlex,128,plain\n\"Sam, jr\",37.8,\"says \"\"hi\"\"\nthen goes\"\n\" padded\",,tab\there\u{1}\n"
        )
    }

    func testJSONLinesEscapesLikeJSONStringify() {
        XCTAssertEqual(
            OpenFormats.render(table, .jsonl),
            #"{"name":"Alex","value":128,"note":"plain"}"# + "\n"
                + #"{"name":"Sam, jr","value":37.8,"note":"says \"hi\"\nthen goes"}"# + "\n"
                + #"{"name":" padded","value":null,"note":"tab\there\u0001"}"# + "\n"
        )
    }

    func testPersonColumnsAreUnique() {
        func p(_ id: String, _ label: String) -> Person {
            Person(id: id, label: label, displayName: "", sex: "unknown", birthYear: nil, notes: "", createdAt: "")
        }
        XCTAssertEqual(OpenFormats.personColumns([p("1", "a"), p("2", "a"), p("3", "b")]).map(\.name), ["a", "a-2", "b"])
    }

    func testGenotypeTableKeepsOnlySharedCallsInChromosomeOrder() throws {
        let repo = try SnapshotTests.loaded()
        let persons = try repo.persons()
        let t = try OpenFormats.genotypeTable(repo.db, OpenFormats.personColumns(persons), shared: true)
        XCTAssertEqual(t.header.prefix(3), ["rsid", "chromosome", "position"])
        XCTAssertEqual(t.rows.count, 7)
        XCTAssertEqual(t.rows.first?[1], .text("1"))
    }
}
