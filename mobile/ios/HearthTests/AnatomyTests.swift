import XCTest
@testable import Hearth

/// A port of `frontend/src/health/body.test.ts` and `teeth.test.ts` where the functions were ported,
/// and of the Android `BodyTest`: the same inputs, the same expected outputs.
final class AnatomyTests: XCTestCase {
    private func at(_ bodyPart: String, _ side: String = "", details: String = "", id: String = "x") -> HealthEntry {
        HealthEntry(
            id: id, personId: "p", date: "2026-10-01", time: "", kind: .symptom, title: "Pain", body: "",
            source: "", bodyPart: bodyPart, severity: nil, tags: [], value: nil, value2: nil, unit: "",
            createdAt: "", side: side, details: details
        )
    }

    func testReadsATypedBodyPartAsTheSuggestedOne() {
        XCTAssertEqual(Anatomy.key(" Knee "), "knees")
        XCTAssertEqual(Anatomy.key("foot"), "feet")
        XCTAssertEqual(Anatomy.key("Teeth"), "mouth")
        XCTAssertEqual(Anatomy.key("LOWER  back"), "lower back")
        XCTAssertEqual(Anatomy.key("Колено"), "колено")
        XCTAssertEqual(Anatomy.key(""), "")
    }

    func testCountsEachPartAndSideWithBothAndUnrecordedOnEither() {
        let heat = Anatomy.heat([at("knees", "left"), at("Knee", "both"), at("knees"), at("knees", "right"), at("head"), at("")])
        XCTAssertEqual(heat.count("knees"), 4)
        XCTAssertEqual(heat.count("knees", "left"), 3)
        XCTAssertEqual(heat.count("knees", "right"), 3)
        XCTAssertEqual(heat.count("head"), 1)
        XCTAssertEqual(heat.count("feet", "left"), 0)
        XCTAssertEqual(heat.max, 3)
        XCTAssertEqual(Set(heat.parts.keys), ["head", "knees"])
    }

    func testScalesTheColourToTheBusiestPart() {
        XCTAssertEqual([0, 1, 2, 3, 10].map { Anatomy.level($0, 10) }, [0, 1, 1, 2, 5])
        XCTAssertEqual(Anatomy.level(1, 0), 5)
        XCTAssertTrue(Anatomy.onSide("", "left"))
        XCTAssertFalse(Anatomy.onSide("right", "left"))
    }

    func testFiltersTheLogTheWayTheMapCountsItAndByTooth() {
        let log = [at("knees", "left", id: "l"), at("Knee", "right", id: "r"), at("knee", id: "n"), at("head", id: "h")]
        XCTAssertEqual(HealthLog.filter(log, HealthFilter(bodyPart: "knees")).map(\.id), ["l", "r", "n"])
        XCTAssertEqual(HealthLog.filter(log, HealthFilter(bodyPart: "knees", side: "left")).map(\.id), ["l", "n"])
        let dental = [at("mouth", details: #"{"teeth":"16 26"}"#, id: "d")] + log
        XCTAssertEqual(HealthLog.filter(dental, HealthFilter(tooth: 26)).map(\.id), ["d"])
    }

    func testReadsAndWritesTeethTheWayTheWebDoes() {
        XCTAssertEqual(Teeth.parse("26 16 x 16 99 55,19"), [16, 26, 55])
        XCTAssertEqual(Teeth.format([26, 16]), "16 26")
        XCTAssertEqual(Teeth.toggle([26], 11), [11, 26])
        XCTAssertEqual(Teeth.toggle([16, 26], 16), [26])
        XCTAssertEqual(Teeth.details([55, 16]), #"{"teeth":"16 55"}"#)
        XCTAssertEqual(Teeth.details([]), "")
        XCTAssertEqual(Teeth.of(#"{"teeth":"16 55","trigger":"cold"}"#), [16, 55])
        XCTAssertEqual(Teeth.of("not json"), [])
        XCTAssertEqual([11, 13, 14, 16, 54].map(Teeth.type), ["incisor", "canine", "premolar", "molar", "molar"])
        XCTAssertEqual(Teeth.permanent[0], [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28])
        XCTAssertEqual(Teeth.milk[1], [85, 84, 83, 82, 81, 71, 72, 73, 74, 75])
        let teeth = Anatomy.teethHeat([at("mouth", details: #"{"teeth":"16 26"}"#), at("mouth", details: #"{"teeth":"16 55"}"#), at("head")])
        XCTAssertEqual(teeth, [16: 2, 26: 1, 55: 1])
    }

    func testPicksTheAgeGroupAdultWhenUnknown() {
        XCTAssertEqual([nil, 16, 13, 12.9, 4, 3.9].map(Anatomy.stage), ["adult", "adult", "teen", "child", "young", "toddler"])
    }

    func testReadsPathsInMLCQZ() {
        let p = BodyFigures.path("M0 0L10 0C10 5 5 10 0 10Q-5 5 0 0Z")
        XCTAssertTrue(p.contains(CGPoint(x: 3, y: 3), eoFill: true))
        XCTAssertFalse(p.contains(CGPoint(x: 20, y: 20), eoFill: true))
        XCTAssertEqual(p.boundingRect.maxX, 10, accuracy: 0.01)
    }
}
