import SwiftUI
import XCTest
@testable import Hearth

/// Mirrors frontend/src/kb/kb.test.ts and sortFindings.test.ts (through the Android KbTest), against
/// the real kb.json, read from the repository through `#filePath` like the backup fixtures.
final class KbTests: XCTestCase {
    private let kbFile = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // HearthTests
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // mobile
        .deletingLastPathComponent() // repository root
        .appendingPathComponent("frontend/public/kb.json")

    private func loadKb() throws -> Kb {
        try Kb.parse(Data(contentsOf: kbFile))
    }

    func testHasEntriesWithSortedGenotypeKeys() throws {
        let kb = try loadKb()
        XCTAssertGreaterThan(kb.entries.count, 20)
        for e in kb.entries {
            for k in e.genotypes.keys {
                XCTAssertEqual(normGenotype(String(k.prefix(1)), String(k.dropFirst().prefix(1))), k)
            }
        }
    }

    func testComputesFindingsAndRiskCopiesRegardlessOfAlleleOrder() throws {
        let f = KbLogic.computeFindings(try loadKb(), [
            Call(rsid: "rs7903146", chromosome: "10", position: 1, a1: "T", a2: "C"),
            Call(rsid: "rs12248560", chromosome: "10", position: 2, a1: "T", a2: "T"),
            Call(rsid: "rs999999", chromosome: "1", position: 3, a1: "A", a2: "A"),
        ])
        XCTAssertEqual(f.count, 2)
        let tcf = try XCTUnwrap(f.first { $0.entry.rsid == "rs7903146" })
        XCTAssertEqual(tcf.genotype, "CT")
        XCTAssertEqual(tcf.riskCopies, 1)
        XCTAssertEqual(tcf.match?.magnitude, 2)
        XCTAssertEqual(f[0].entry.rsid, "rs12248560")
    }

    func testSearchesDrugsAndConditions() throws {
        let kb = try loadKb()
        XCTAssertTrue(KbLogic.search(kb, "clopidogrel").map(\.rsid).contains("rs4244285"))
        XCTAssertTrue(KbLogic.search(kb, "diabetes").map(\.gene).contains("TCF7L2"))
        XCTAssertEqual(KbLogic.search(kb, ""), [])
    }

    private func finding(_ rsid: String, _ gene: String, _ evidence: String, _ topic: String, _ magnitude: Double?, _ riskCopies: Int) -> Finding {
        Finding(
            entry: KbEntry(
                rsid: rsid, gene: gene, name: "", riskAllele: "A", evidence: evidence, summary: "", genotypes: [:],
                sources: [], drugs: [], conditions: [], topic: topic, generatedBy: ""
            ),
            genotype: "AA",
            call: Call(rsid: rsid, chromosome: "1", position: 1, a1: "A", a2: "A"),
            match: magnitude.map { KbGenotype(label: "", magnitude: $0) },
            riskCopies: riskCopies
        )
    }

    func testSortsFindingsLikeTheWeb() {
        let rows = [
            finding("rs1", "MTHFR", "C", "b", 2, 1),
            finding("rs2", "APOE", "A", "a", 3, 2),
            finding("rs3", "CYP2C19", "B", "c", nil, 0),
            finding("rs4", "APOE", "A", "a", 1, 2),
        ]
        func ids(_ key: FindingSortKey, _ ascending: Bool) -> [String] {
            KbLogic.sortFindings(rows, key, ascending: ascending).map(\.entry.rsid)
        }
        XCTAssertEqual(ids(.gene, true), ["rs2", "rs4", "rs3", "rs1"])
        XCTAssertEqual(ids(.gene, false), ["rs1", "rs3", "rs4", "rs2"])
        XCTAssertEqual(ids(.magnitude, false), ["rs2", "rs1", "rs4", "rs3"])
        XCTAssertEqual(ids(.magnitude, true), ["rs3", "rs4", "rs1", "rs2"])
        XCTAssertEqual(ids(.evidence, true), ["rs2", "rs4", "rs3", "rs1"])
        XCTAssertEqual(ids(.riskCopies, false), ["rs2", "rs4", "rs1", "rs3"])
        XCTAssertEqual(ids(.topic, true), ["rs2", "rs4", "rs1", "rs3"])
    }

    func testPrintsMagnitudesLikeJavaScript() {
        XCTAssertEqual(plainNumber(12), "12")
        XCTAssertEqual(plainNumber(2.5), "2.5")
    }

    func testRichMarksTaggedTextBold() {
        let text = rich("a <b>bold</b> and <r>A</r>", colors: ["r": .red])
        XCTAssertEqual(String(text.characters), "a bold and A")
        let bold = text.runs.filter { $0.inlinePresentationIntent == .stronglyEmphasized }
        XCTAssertEqual(bold.map { String(text[$0.range].characters) }, ["bold", "A"])
    }
}
