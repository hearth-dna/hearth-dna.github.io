import XCTest
@testable import Hearth

/// Mirrors frontend/src/family/inheritance.test.ts (through the Android InheritanceTest).
final class InheritanceTests: XCTestCase {
    private func c(_ g: String) -> Call {
        Call(rsid: "rs1", chromosome: "1", position: 1, a1: String(g.prefix(1)), a2: String(g.dropFirst().prefix(1)))
    }

    private func from(_ child: String, _ mum: String? = nil, _ dad: String? = nil) -> [String] {
        Inheritance.alleleOrigins(c(child), [
            Inheritance.ParentCall(id: "mum", call: mum.map(c)),
            Inheritance.ParentCall(id: "dad", call: dad.map(c)),
        ]).map(\.from)
    }

    func testPhases() {
        XCTAssertEqual(from("AG", "AA", "GG"), ["mum", "dad"])
        XCTAssertEqual(from("GA", "AA", "GG"), ["dad", "mum"])
        XCTAssertEqual(from("AG", "AG", "GG"), ["mum", "dad"])
        XCTAssertEqual(from("AA", "AG", "AG"), ["mum", "dad"])
        XCTAssertEqual(from("AG", "AG", "AG"), ["ambiguous", "ambiguous"])
    }

    func testFlagsImpossiblePairs() {
        XCTAssertEqual(from("AA", "GG", "AG"), ["impossible", "impossible"])
        XCTAssertEqual(from("TT", "CC"), ["impossible", "impossible"])
    }

    func testHandlesOneTypedParent() {
        XCTAssertEqual(from("AG", "AA"), ["mum", "dad"])
        XCTAssertEqual(from("AG", nil, "GG"), ["mum", "dad"])
        XCTAssertEqual(from("AG", "AG"), ["ambiguous", "ambiguous"])
        XCTAssertEqual(from("AA", "AG"), ["mum", "dad"])
    }

    func testNoCallsAndUntypedParents() {
        XCTAssertEqual(from("A-", "AA", "GG"), [])
        XCTAssertEqual(from("AG"), ["untyped", "untyped"])
    }

    private func p(_ id: String, _ createdAt: String) -> Person {
        Person(id: id, label: id, displayName: id, sex: "unknown", birthYear: nil, notes: "", createdAt: createdAt)
    }

    private func r(_ parent: String, _ child: String) -> Relationship {
        Relationship(parentId: parent, childId: child)
    }

    func testFoundersOnTopCoParentsSideBySideChildrenUnderThem() throws {
        let nodes = Inheritance.layoutPedigree(
            [p("kid", "3"), p("gran", "0"), p("mum", "1"), p("dad", "2"), p("uncle", "4")],
            [r("gran", "mum"), r("gran", "uncle"), r("mum", "kid"), r("dad", "kid")]
        )
        func at(_ id: String) throws -> PedigreeNode { try XCTUnwrap(nodes.first { $0.person.id == id }) }
        XCTAssertEqual(nodes.map(\.person.id), ["kid", "gran", "mum", "dad", "uncle"])
        XCTAssertEqual(
            try [at("gran").generation, at("dad").generation, at("mum").generation, at("kid").generation],
            [0, 1, 1, 2]
        )
        XCTAssertLessThan(try at("mum").column, try at("uncle").column)
        XCTAssertEqual(abs(try at("dad").column - at("mum").column), 1)
        XCTAssertEqual(try at("kid").parents.sorted(), ["dad", "mum"])
    }

    func testKeepsAChildBelowAParentPulledDownToACoParent() throws {
        let nodes = Inheritance.layoutPedigree(
            [p("gran", "0"), p("mum", "1"), p("dad", "2"), p("kid", "3"), p("step", "4"), p("half", "5")],
            [r("gran", "mum"), r("mum", "kid"), r("dad", "kid"), r("dad", "half"), r("step", "half")]
        )
        func at(_ id: String) throws -> PedigreeNode { try XCTUnwrap(nodes.first { $0.person.id == id }) }
        XCTAssertEqual(try [at("step").generation, at("half").generation], [1, 2])
    }
}
