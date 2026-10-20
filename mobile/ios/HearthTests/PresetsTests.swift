import XCTest
@testable import Hearth

/// The presets are a hand-kept copy of frontend/src/health/presets.ts; this keeps them in step, and
/// checks the naming of saved entries (`presetOf`, `entryTitle`) like the Android PresetsTest.
final class PresetsTests: XCTestCase {
    private static let healthDir = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // HearthTests
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // mobile
        .deletingLastPathComponent() // repository root
        .appendingPathComponent("frontend/src/health")

    private func webIds(_ call: String) throws -> [String] {
        let web = try String(contentsOf: PresetsTests.healthDir.appendingPathComponent("presets.ts"))
        let re = try NSRegularExpression(pattern: "\\b\(call)\\(\\s*'([a-z0-9-]+)'")
        let range = NSRange(web.startIndex..., in: web)
        return re.matches(in: web, range: range).map { String(web[Range($0.range(at: 1), in: web)!]) }
    }

    func testHasTheWebsMeasurementAndSymptomPresetsInTheWebsOrder() throws {
        XCTAssertEqual(HealthPresets.measurements.map(\.id), try webIds("m"))
        XCTAssertEqual(HealthPresets.symptoms.map(\.id), try webIds("s"))
    }

    func testHasTheWebsSymptomSynonyms() throws {
        let data = try Data(contentsOf: PresetsTests.healthDir.appendingPathComponent("synonyms.json"))
        let web = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: [String]])
        for p in HealthPresets.symptoms + HealthPresets.events.filter({ $0.kind == .symptom }) {
            XCTAssertEqual(p.synonyms, web[p.id] ?? [], p.id)
        }
    }

    private func entry(_ kind: HealthKind, _ title: String) -> HealthEntry {
        HealthEntry(
            id: "x", personId: "p", date: "2026-09-14", time: "", kind: kind, title: title, body: "", source: "",
            bodyPart: "", severity: nil, tags: [], value: nil, value2: nil, unit: "", createdAt: ""
        )
    }

    private let name = { (key: String) in "T(\(key))" }

    func testNamesAnEntryByItsPresetInTheUILanguageWhateverNameItWasSavedUnder() {
        XCTAssertEqual(HealthPresets.entryTitle(entry(.symptom, "Headache"), name), "T(preset.headache)")
        XCTAssertEqual(HealthPresets.entryTitle(entry(.symptom, "  ГОЛОВНАЯ боль "), name), "T(preset.headache)")
        XCTAssertEqual(HealthPresets.entryTitle(entry(.symptom, "Eye irritation"), name), "T(preset.eye-irritation)")
        XCTAssertEqual(HealthPresets.entryTitle(entry(.measurement, "вес"), name), "T(preset.weight)")
        XCTAssertEqual(HealthPresets.entryTitle(entry(.symptom, "Injury"), name), "T(preset.injury)")
        // Another kind's preset does not claim the entry, and an unknown title stays as typed.
        XCTAssertEqual(HealthPresets.entryTitle(entry(.other, "Headache"), name), "Headache")
        XCTAssertEqual(HealthPresets.entryTitle(entry(.symptom, "Knee clicks"), name), "Knee clicks")
        XCTAssertNil(HealthPresets.presetOf(kind: .symptom, title: ""))
    }

    func testSearchesAndSortsByTheShownName() {
        var a = entry(.symptom, "Headache")
        a.id = "a"
        var b = entry(.symptom, "Fever")
        b.id = "b"
        let shown = { (e: HealthEntry) in e.id == "a" ? "Zzz" : "Aaa" }
        XCTAssertEqual(HealthLog.filter([a, b], HealthFilter(text: "zz"), title: shown).map(\.id), ["a"])
        XCTAssertEqual(HealthLog.filter([a, b], HealthFilter(text: "headache"), title: shown).map(\.id), ["a"])
        XCTAssertEqual(HealthLog.sort([a, b], .title, .asc, title: shown).map(\.id), ["b", "a"])
    }

    func testOrdersTheQuickSymptomListByWhatWasRecordedUnderAnyNameEventsLeftOut() {
        let all = HealthPresets.symptoms.map(\.id)
        XCTAssertEqual(HealthPresets.symptomOrder([]).map(\.id), all)
        // Newest first; a Russian title counts as the preset it names.
        let order = HealthPresets.symptomOrder([entry(.symptom, "кашель"), entry(.symptom, "Fever"), entry(.symptom, "Cough")]).map(\.id)
        XCTAssertEqual(Array(order.prefix(2)), ["cough", "fever"])
        XCTAssertEqual(order.sorted(), all.sorted())
        // Events, other kinds and unknown titles do not reorder it.
        let ignored = [
            entry(.symptom, "Injury"), entry(.symptom, "Fainting"), entry(.measurement, "Weight"),
            entry(.other, "Headache"), entry(.symptom, "Knee clicks"),
        ]
        XCTAssertEqual(HealthPresets.symptomOrder(ignored).map(\.id), all)
        XCTAssertNil(HealthPresets.symptomPreset("Injury"))
        XCTAssertEqual(HealthPresets.symptomPreset("  ГОЛОВНАЯ боль ")?.id, "headache")
    }
}
