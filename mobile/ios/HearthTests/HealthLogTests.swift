import XCTest
@testable import Hearth

/// A port of `frontend/src/health/log.test.ts` (and the preset checks beside it): the same inputs,
/// the same expected outputs. When one of these fails and the web's passes, the Swift is wrong.
final class HealthLogTests: XCTestCase {
    private func entry(
        id: String = "x",
        personId: String = "p",
        date: String = "2026-09-14",
        time: String = "",
        kind: HealthKind = .symptom,
        title: String = "Pain",
        body: String = "",
        bodyPart: String = "",
        severity: Int? = nil,
        tags: [String] = [],
        value: Double? = nil,
        value2: Double? = nil,
        unit: String = "",
        createdAt: String = "2026-09-14T00:00:00Z"
    ) -> HealthEntry {
        HealthEntry(
            id: id, personId: personId, date: date, time: time, kind: kind, title: title, body: body,
            source: "", bodyPart: bodyPart, severity: severity, tags: tags, value: value, value2: value2,
            unit: unit, createdAt: createdAt
        )
    }

    // MARK: - tags

    func testTagsParseLooselyTypedListsAndRoundTrip() {
        XCTAssertEqual(HealthLog.parseTags("Arthritis, flare ,,Flare, "), ["arthritis", "flare"])
        XCTAssertEqual(HealthLog.parseTags(""), [])
        XCTAssertEqual(HealthLog.formatTags(["a", "b"]), "a, b")
        XCTAssertEqual(HealthLog.parseTags(HealthLog.formatTags(["a", "b"])), ["a", "b"])
    }

    // MARK: - describeEntry

    func testDescribeAppendsBodyPartSeverityAndTagsOnlyWhenPresent() {
        XCTAssertEqual(
            HealthLog.describeEntry(entry(kind: .lab, title: "Lipid panel")),
            "2026-09-14 · Lab result · Lipid panel"
        )
        XCTAssertEqual(
            HealthLog.describeEntry(entry(title: "Pain in both hands", bodyPart: "hands", severity: 6, tags: ["arthritis"])),
            "2026-09-14 · Symptom · Pain in both hands (hands; severity 6/10; arthritis)"
        )
    }

    func testDescribePutsTheMeasuredValueAfterTheTitle() {
        XCTAssertEqual(
            HealthLog.describeEntry(entry(
                kind: .measurement, title: "Blood pressure", bodyPart: "heart", value: 120, value2: 80, unit: "mmHg"
            )),
            "2026-09-14 · Measurement · Blood pressure 120/80 mmHg (heart)"
        )
        XCTAssertEqual(
            HealthLog.describeEntry(entry(kind: .measurement, title: "Temperature", value: 37.8, unit: "°C")),
            "2026-09-14 · Measurement · Temperature 37.8 °C"
        )
    }

    // MARK: - formatValue

    func testFormatValueHandlesSingleValuesPairsAndMissingUnits() {
        XCTAssertEqual(HealthLog.formatValue(entry(unit: "°C")), "")
        XCTAssertEqual(HealthLog.formatValue(entry(value: 72)), "72")
        XCTAssertEqual(HealthLog.formatValue(entry(value: 120, value2: 80, unit: "mmHg")), "120/80 mmHg")
    }

    // MARK: - presets

    func testPresetsHaveUniqueIdsAndMeasurementsAlwaysCarryAUnit() {
        let ids = HealthPresets.all.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        for preset in HealthPresets.all {
            if preset.kind == .measurement {
                XCTAssertFalse((preset.unit ?? "").isEmpty, preset.id)
            } else {
                XCTAssertNil(preset.unit, preset.id)
            }
        }
        XCTAssertEqual(HealthPresets.find("blood-pressure")?.pair, ["systolic", "diastolic"])
        XCTAssertEqual(HealthPresets.find("nosebleed")?.kind, .symptom)
        XCTAssertEqual(HealthPresets.find("nosebleed")?.bodyPart, "nose")
        XCTAssertNil(HealthPresets.find("nope"))
    }

    // MARK: - filter

    private var log: [HealthEntry] {
        [
            entry(id: "1", title: "Pain in hands", bodyPart: "hands", severity: 6, tags: ["arthritis"]),
            entry(id: "2", title: "Headache", bodyPart: "head", severity: 3, tags: ["migraine"]),
            entry(id: "3", kind: .lab, title: "CRP", body: "CRP 12 mg/L", tags: ["arthritis"]),
            entry(id: "4", kind: .measurement, title: "Temperature", value: 38.2, unit: "°C"),
        ]
    }

    private func ids(_ entries: [HealthEntry], _ f: HealthFilter) -> [String] {
        HealthLog.filter(entries, f).map(\.id)
    }

    func testNoFilterPassesEverything() {
        XCTAssertEqual(ids(log, HealthFilter()), ["1", "2", "3", "4"])
    }

    func testFiltersByKindBodyPartAndTag() {
        XCTAssertEqual(ids(log, HealthFilter(kind: .symptom)), ["1", "2"])
        XCTAssertEqual(ids(log, HealthFilter(bodyPart: "head")), ["2"])
        XCTAssertEqual(ids(log, HealthFilter(tag: "arthritis")), ["1", "3"])
        XCTAssertEqual(ids(log, HealthFilter(kind: .lab, tag: "arthritis")), ["3"])
    }

    func testSearchesTitleBodyBodyPartUnitAndTagsCaseInsensitively() {
        XCTAssertEqual(ids(log, HealthFilter(text: "HAND")), ["1"])
        XCTAssertEqual(ids(log, HealthFilter(text: "mg/l")), ["3"])
        XCTAssertEqual(ids(log, HealthFilter(text: "migr")), ["2"])
        XCTAssertEqual(ids(log, HealthFilter(text: "°c")), ["4"])
        XCTAssertEqual(ids(log, HealthFilter(kind: .measurement)), ["4"])
    }

    func testFiltersByPersonDateRangeAndMinimumSeverity() {
        let more = [
            entry(id: "a", personId: "p1", date: "2026-01-05", severity: 2),
            entry(id: "b", personId: "p2", date: "2026-02-10", severity: 7),
            entry(id: "c", personId: "p1", date: "2026-03-15"),
        ]
        XCTAssertEqual(ids(more, HealthFilter(person: "p1")), ["a", "c"])
        XCTAssertEqual(ids(more, HealthFilter(from: "2026-02-10")), ["b", "c"])
        XCTAssertEqual(ids(more, HealthFilter(to: "2026-02-10")), ["a", "b"])
        XCTAssertEqual(ids(more, HealthFilter(minSeverity: 3)), ["b"])
        XCTAssertFalse(HealthFilter().isFiltering)
        XCTAssertTrue(HealthFilter(minSeverity: 1).isFiltering)
    }

    func testListsDistinctFacetsSorted() {
        let f = HealthLog.facets(log)
        XCTAssertEqual(f.bodyParts, ["hands", "head"])
        XCTAssertEqual(f.tags, ["arthritis", "migraine"])
    }

    // MARK: - sort

    private var sortLog: [HealthEntry] {
        [
            entry(id: "1", personId: "b", date: "2026-01-01", kind: .lab, title: "CRP", createdAt: "1"),
            entry(id: "2", personId: "a", date: "2026-03-01", title: "ache", severity: 4, createdAt: "2"),
            entry(id: "3", personId: "a", date: "2026-02-01", kind: .measurement, title: "Weight", value: 70, createdAt: "3"),
            entry(id: "4", personId: "b", date: "2026-03-01", title: "Back pain", severity: 8, createdAt: "4"),
        ]
    }

    private func sorted(
        _ key: HealthSortKey, _ dir: SortDir, _ name: @escaping (String) -> String = { $0 }
    ) -> [String] {
        HealthLog.sort(sortLog, key, dir, personName: name).map(\.id)
    }

    func testSortsByDateBothWaysTiesNewestCreatedFirst() {
        XCTAssertEqual(sorted(.date, .desc), ["4", "2", "3", "1"])
        XCTAssertEqual(sorted(.date, .asc), ["1", "3", "4", "2"])
    }

    func testKeepsEmptyValuesLastInEitherDirection() {
        XCTAssertEqual(sorted(.severity, .desc), ["4", "2", "3", "1"])
        XCTAssertEqual(sorted(.severity, .asc), ["2", "4", "3", "1"])
        XCTAssertEqual(sorted(.value, .asc).first, "3")
    }

    func testSortsTitlesCaseInsensitivelyAndPeopleByDisplayName() {
        XCTAssertEqual(sorted(.title, .asc), ["2", "4", "1", "3"])
        XCTAssertEqual(sorted(.person, .asc) { $0 == "a" ? "Zoe" : "Adam" }, ["4", "1", "2", "3"])
    }

    func testDefaultDirectionsAreNewestHighestAndWorstFirst() {
        XCTAssertEqual(HealthSortKey.date.defaultDir, .desc)
        XCTAssertEqual(HealthSortKey.value.defaultDir, .desc)
        XCTAssertEqual(HealthSortKey.severity.defaultDir, .desc)
        XCTAssertEqual(HealthSortKey.title.defaultDir, .asc)
    }

    // MARK: - time of day

    func testNormalisesHHMMAndRejectsAnythingElse() {
        XCTAssertEqual(HealthLog.normTime("8:05"), "08:05")
        XCTAssertEqual(HealthLog.normTime("23:59"), "23:59")
        XCTAssertEqual(HealthLog.normTime("07:30:12"), "07:30")
        XCTAssertEqual(HealthLog.normTime("24:00"), "")
        XCTAssertEqual(HealthLog.normTime("12:60"), "")
        XCTAssertEqual(HealthLog.normTime("noon"), "")
        XCTAssertEqual(HealthLog.normTime(""), "")
    }

    func testShowsTheTimeAfterTheDateOnlyWhenThereIsOne() {
        XCTAssertEqual(HealthLog.when(entry(time: "06:45")), "2026-09-14 06:45")
        XCTAssertEqual(HealthLog.when(entry(time: "")), "2026-09-14")
        XCTAssertTrue(HealthLog.describeEntry(entry(time: "21:10", title: "Temp")).hasPrefix("2026-09-14 21:10 · "))
        XCTAssertTrue(HealthLog.describeEntry(entry(title: "Temp")).hasPrefix("2026-09-14 · "))
    }

    func testOrdersSameDayEntriesByTimeUntimedFirstWhenAscending() {
        let day = [
            entry(id: "evening", time: "21:00", createdAt: "1"),
            entry(id: "untimed", time: "", createdAt: "2"),
            entry(id: "morning", time: "07:00", createdAt: "3"),
        ]
        XCTAssertEqual(HealthLog.sort(day, .date, .desc).map(\.id), ["evening", "morning", "untimed"])
        XCTAssertEqual(HealthLog.sort(day, .date, .asc).map(\.id), ["untimed", "morning", "evening"])
    }

    // MARK: - dates

    func testFormatsTheLocalCalendarDate() throws {
        let late = try XCTUnwrap(Calendar.current.date(from: DateComponents(year: 2026, month: 1, day: 5, hour: 23, minute: 59)))
        XCTAssertEqual(HealthLog.localDate(late), "2026-01-05")
    }

    func testStepsBackAcrossMonthsYearsAndLeapDays() {
        XCTAssertEqual(HealthLog.daysBefore("2026-09-14", 0), "2026-09-14")
        XCTAssertEqual(HealthLog.daysBefore("2026-03-01", 1), "2026-02-28")
        XCTAssertEqual(HealthLog.daysBefore("2024-03-01", 1), "2024-02-29")
        XCTAssertEqual(HealthLog.daysBefore("2026-01-03", 6), "2025-12-28")
    }

    // MARK: - card view helpers

    func testCountsPanelFiltersADateRangeOnceAndIgnoresKindAndSearchText() {
        XCTAssertEqual(HealthFilter().panelCount, 0)
        XCTAssertEqual(HealthFilter(kind: .lab, text: "x").panelCount, 0)
        XCTAssertEqual(HealthFilter(tag: "a", from: "2026-01-01", to: "2026-02-01").panelCount, 2)
        XCTAssertEqual(HealthFilter(person: "p", bodyPart: "hands", to: "2026-01-01", minSeverity: 1).panelCount, 4)
    }

    func testGroupsConsecutiveEntriesByDateKeepingOrder() {
        let groups = HealthLog.groupByDate([
            entry(id: "a", date: "2026-09-14"),
            entry(id: "b", date: "2026-09-14"),
            entry(id: "c", date: "2026-09-12"),
        ])
        XCTAssertEqual(groups.map(\.date), ["2026-09-14", "2026-09-12"])
        XCTAssertEqual(groups.map { $0.entries.map(\.id) }, [["a", "b"], ["c"]])
        XCTAssertEqual(HealthLog.groupByDate([]), [])
    }

    // MARK: - strings

    func testInterpolatesLikeTheWeb() {
        XCTAssertEqual(Strings.interpolate("{n} of {m}", ["n": 3, "m": 10]), "3 of 10")
        XCTAssertEqual(Strings.interpolate("keep {missing} and {n}", ["n": 1]), "keep {missing} and 1")
        XCTAssertEqual(Strings.interpolate("a{b{n}}", ["n": 2]), "a{b2}")
    }
}
