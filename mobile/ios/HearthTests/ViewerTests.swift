import XCTest
@testable import Hearth

/// Mirrors frontend/src/kb/viewer.test.ts (through the Android ViewerTest), against the real kb.json.
final class ViewerTests: XCTestCase {
    private let kbFile = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // HearthTests
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // mobile
        .deletingLastPathComponent() // repository root
        .appendingPathComponent("frontend/public/kb.json")

    private func loadKb() throws -> Kb { try Kb.parse(Data(contentsOf: kbFile)) }

    private func person(_ id: String) -> Person {
        Person(id: id, label: id, displayName: id, sex: "unknown", birthYear: nil, notes: "", createdAt: "")
    }

    private func call(_ rsid: String, _ a1: String, _ a2: String) -> Call {
        Call(rsid: rsid, chromosome: "1", position: 1, a1: a1, a2: a2)
    }

    func testRanksEstablishedMedicalHighImpactMarkersFirst() throws {
        let kb = try loadKb()
        let ranked = Viewer.rankEntries(kb)
        XCTAssertEqual(ranked.count, kb.entries.count)
        let grades = ranked.map(\.evidence).joined()
        XCTAssertEqual(grades, String(grades.sorted()))
        XCTAssertEqual(ranked[0].evidence, "A")
        XCTAssertNotEqual(ranked[0].topic, "brain_and_body")
    }

    private func findingsBy(_ kb: Kb) -> [String: [Finding]] {
        [
            "a": KbLogic.computeFindings(kb, [call("rs7903146", "T", "T"), call("rs4680", "A", "G")]),
            "b": KbLogic.computeFindings(kb, [call("rs7903146", "C", "C")]),
        ]
    }

    func testShowsEveryMarkerByDefaultWithGenotypesWherePeopleHaveThem() throws {
        let kb = try loadKb()
        let rows = Viewer.rows(kb, findingsBy(kb), ["a", "b"], Viewer.Filter())
        XCTAssertEqual(rows.count, kb.entries.count)
        XCTAssertEqual(Set(try XCTUnwrap(rows.first { $0.entry.rsid == "rs7903146" }).findings.keys), ["a", "b"])
        XCTAssertNil(try XCTUnwrap(rows.first { $0.entry.rsid == "rs4680" }).findings["b"])
    }

    func testFiltersByAreaTextAndNotability() throws {
        let kb = try loadKb()
        func ids(_ f: Viewer.Filter, _ people: [String] = ["a", "b"]) -> [String] {
            Viewer.rows(kb, findingsBy(kb), people, f).map(\.entry.rsid)
        }
        XCTAssertTrue(ids(Viewer.Filter(areas: ["diabetes"])).contains("rs7903146"))
        XCTAssertFalse(ids(Viewer.Filter(areas: ["diabetes"])).contains("rs4680"))
        XCTAssertTrue(Set(["rs7903146", "rs4680"]).isSubset(of: ids(Viewer.Filter(areas: ["diabetes", "mental"]))))
        XCTAssertEqual(ids(Viewer.Filter(query: "TCF7L2")), ["rs7903146"])
        XCTAssertEqual(ids(Viewer.Filter(notable: true)), ["rs7903146"])
        XCTAssertEqual(ids(Viewer.Filter(notable: true), ["b"]), [])
    }

    func testPacksOnlyShownPeopleWhoHaveGenotypesInTheRows() throws {
        let kb = try loadKb()
        let rows = Viewer.rows(
            kb, ["a": KbLogic.computeFindings(kb, [call("rs7903146", "C", "T")])], ["a", "b"],
            Viewer.Filter(areas: ["diabetes"])
        )
        let packed = Viewer.packPeople(rows, [person("a"), person("b")])
        XCTAssertEqual(packed.map(\.person.id), ["a"])
        XCTAssertEqual(packed[0].findings.map(\.entry.rsid), ["rs7903146"])
    }

    func testAsksAboutTheChosenAreasInEnglish() throws {
        let kb = try loadKb()
        XCTAssertTrue(Viewer.question(kb, ["memory", "diabetes"]).hasPrefix("What do these genotypes mean for diabetes and weight, memory"))
        XCTAssertTrue(Viewer.question(kb, []).hasPrefix("What do these genotypes mean,"))
    }
}
