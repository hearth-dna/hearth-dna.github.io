import Foundation

// A port of `frontend/src/health/log.ts` and the types it uses from `frontend/src/types.ts`. The
// web code is the reference: when the two disagree the web is right, and HealthLogTests (a port of
// log.test.ts) is where the difference should show up first.

/// What an entry is. The raw values are what the `kind` column stores.
enum HealthKind: String, CaseIterable, Identifiable {
    case symptom, measurement, lab, imaging, diagnosis, medication, letter, other

    var id: String { rawValue }

    /// `HEALTH_KIND_LABELS`: English, fixed. `describeEntry` and the kind sort use these rather
    /// than the translation, exactly as the web does; the screens show `kind.<raw>` instead.
    var label: String {
        switch self {
        case .symptom: return "Symptom"
        case .measurement: return "Measurement"
        case .lab: return "Lab result"
        case .imaging: return "Imaging report"
        case .diagnosis: return "Diagnosis"
        case .medication: return "Medication"
        case .letter: return "Doctor letter"
        case .other: return "Other"
        }
    }
}

/// Suggestions for the body-part field (`BODY_PARTS`); free text is accepted too.
let BODY_PARTS = [
    "head", "eyes", "ears", "nose", "mouth", "throat", "neck", "chest", "heart", "lungs", "abdomen",
    "stomach", "back", "lower back", "hips", "shoulders", "arms", "elbows", "wrists", "hands",
    "fingers", "legs", "knees", "ankles", "feet", "skin", "joints", "muscles", "whole body",
]

struct Person: Identifiable, Equatable {
    let id: String
    let label: String
    let displayName: String
    let sex: String
    let birthYear: Int?
    let notes: String
    let createdAt: String
}

/// One dated entry in a person's health log; field for field the web's `HealthEntry`.
struct HealthEntry: Identifiable, Equatable {
    var id: String
    var personId: String
    /// YYYY-MM-DD, the document's date, not the import date.
    var date: String
    /// HH:MM local time of day, '' when unknown or not recorded.
    var time: String
    var kind: HealthKind
    var title: String
    var body: String
    /// '' when typed by hand; `<model>:…` when transcribed by a model.
    var source: String
    var bodyPart: String
    /// 1 (barely noticeable) to 10 (worst imaginable); nil when not rated.
    var severity: Int?
    var tags: [String]
    var value: Double?
    var value2: Double?
    var unit: String
    var createdAt: String
}

/// An original document kept with an entry. Only the metadata is here; the bytes live beside the
/// database and are not part of this slice.
struct Attachment: Identifiable, Equatable {
    let id: String
    let healthLogId: String
    let personId: String
    let sha256: String
    let mime: String
    let bytes: Int
    /// The file name to show; never used to build a file name on disk.
    let name: String
    let createdAt: String
}

struct HealthFilter: Equatable {
    /// Person id; '' for everyone.
    var person = ""
    var kind: HealthKind?
    var bodyPart = ""
    var tag = ""
    /// Inclusive YYYY-MM-DD bounds; '' for open-ended.
    var from = ""
    var to = ""
    /// Only entries rated at least this much; nil for any (including unrated).
    var minSeverity: Int?
    /// Case-insensitive substring of title, body, body part, unit or tags.
    var text = ""

    /// `isFiltering`.
    var isFiltering: Bool { self != HealthFilter() }

    /// Filters set in the Filters sheet (not the kind chips or the search field): the count on its
    /// button. A date range counts once.
    var panelCount: Int {
        [!person.isEmpty, !bodyPart.isEmpty, !tag.isEmpty, !from.isEmpty || !to.isEmpty, minSeverity != nil]
            .filter { $0 }.count
    }
}

enum HealthSortKey: String, CaseIterable, Identifiable {
    case date, person, kind, title, value, bodyPart, severity

    var id: String { rawValue }

    /// `HEALTH_SORT_DEFAULT_DIR`: the direction a key starts in — newest, highest and worst first.
    var defaultDir: SortDir {
        switch self {
        case .date, .value, .severity: return .desc
        case .person, .kind, .title, .bodyPart: return .asc
        }
    }
}

enum SortDir: String {
    case asc, desc

    var flipped: SortDir { self == .asc ? .desc : .asc }
}

/// Consecutive entries sharing a date: one day heading in the card view.
struct DayGroup: Identifiable, Equatable {
    let date: String
    var entries: [HealthEntry]

    var id: String { date }
}

enum HealthLog {
    /// 'Arthritis, flare ,,Flare' → ['arthritis', 'flare']: lower-case, trimmed, de-duplicated, in order.
    static func parseTags(_ text: String) -> [String] {
        var out: [String] = []
        for raw in text.split(separator: ",", omittingEmptySubsequences: false) {
            let tag = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if !tag.isEmpty && !out.contains(tag) { out.append(tag) }
        }
        return out
    }

    /// Inverse of parseTags; what the `tags` column stores.
    static func formatTags(_ tags: [String]) -> String {
        tags.joined(separator: ", ")
    }

    /// '8:05' → '08:05'; anything that is not a valid 24-hour H:MM or HH:MM (seconds allowed and
    /// dropped) becomes ''.
    static func normTime(_ text: String) -> String {
        let parts = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: ":", omittingEmptySubsequences: false)
        let digits = { (s: Substring) in !s.isEmpty && s.allSatisfy { $0.isASCII && $0.isNumber } }
        guard parts.count == 2 || parts.count == 3,
              (1...2).contains(parts[0].count), digits(parts[0]),
              parts[1].count == 2, digits(parts[1]),
              parts.count == 2 || (parts[2].count == 2 && digits(parts[2])),
              let hours = Int(parts[0]), let minutes = Int(parts[1]),
              hours <= 23, minutes <= 59
        else { return "" }
        return "\(parts[0].count == 1 ? "0" : "")\(parts[0]):\(parts[1])"
    }

    /// Today (or `date`) as a local YYYY-MM-DD, not UTC: late in the evening UTC is already tomorrow.
    static func localDate(_ date: Date = Date(), calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return ymd(c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// The YYYY-MM-DD `days` calendar days before `date`. Counted in UTC, as the web does, so no
    /// daylight-saving change can make a day 23 hours long. Input that is not a date comes back
    /// unchanged; callers only pass `localDate()` output.
    static func daysBefore(_ date: String, _ days: Int) -> String {
        guard let day = parseDate(date, calendar: utc),
              let earlier = utc.date(byAdding: .day, value: -days, to: day)
        else { return date }
        return localDate(earlier, calendar: utc)
    }

    /// A YYYY-MM-DD as midnight in `calendar`'s time zone; nil when it is not one.
    static func parseDate(_ text: String, calendar: Calendar = .current) -> Date? {
        let parts = text.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2])
        else { return nil }
        let components = DateComponents(year: y, month: m, day: d)
        guard components.isValidDate(in: calendar) else { return nil }
        return calendar.date(from: components)
    }

    /// '2026-09-14 08:05', or just the date when no time was recorded.
    static func when(_ e: HealthEntry) -> String {
        e.time.isEmpty ? e.date : "\(e.date) \(e.time)"
    }

    /// '37.8 °C', '120/80 mmHg', '72' (no unit); '' when the entry has no value.
    static func formatValue(_ e: HealthEntry) -> String {
        guard let value = e.value else { return "" }
        let n = e.value2.map { "\(jsNumber(value))/\(jsNumber($0))" } ?? jsNumber(value)
        return e.unit.isEmpty ? n : "\(n) \(e.unit)"
    }

    /// A number as JavaScript's `String(n)` writes it: `128`, not Swift's `128.0`; `37.8` as is.
    static func jsNumber(_ n: Double) -> String {
        if n.rounded() == n && abs(n) < 1e15 { return String(Int64(n)) }
        return String(n)
    }

    /// The entry on one line, as in the log and the Ask context pack:
    /// `2026-09-14 · Symptom · Pain in both hands (hands; severity 6/10; arthritis)`.
    /// Like the web's, it must never mention attachments: a file name would leave the device with it.
    static func describeEntry(_ e: HealthEntry) -> String {
        let value = formatValue(e)
        let extra = [e.bodyPart, e.severity.map { "severity \($0)/10" } ?? "", formatTags(e.tags)]
            .filter { !$0.isEmpty }
        var line = "\(when(e)) · \(e.kind.label) · \(e.title)"
        if !value.isEmpty { line += " \(value)" }
        if !extra.isEmpty { line += " (\(extra.joined(separator: "; ")))" }
        return line
    }

    /// `filterHealthLog`.
    static func filter(_ entries: [HealthEntry], _ f: HealthFilter) -> [HealthEntry] {
        let q = f.text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return entries.filter { e in
            if !f.person.isEmpty && e.personId != f.person { return false }
            if let kind = f.kind, e.kind != kind { return false }
            if !f.bodyPart.isEmpty && e.bodyPart != f.bodyPart { return false }
            if !f.tag.isEmpty && !e.tags.contains(f.tag) { return false }
            if !f.from.isEmpty && e.date < f.from { return false }
            if !f.to.isEmpty && e.date > f.to { return false }
            if let least = f.minSeverity {
                guard let severity = e.severity, severity >= least else { return false }
            }
            if q.isEmpty { return true }
            let fields = [e.title, e.body, e.bodyPart, e.unit] + e.tags
            return fields.contains { $0.lowercased().contains(q) }
        }
    }

    /// `sortHealthLog`: stable; ties fall back to newest first. Empty values (no measurement,
    /// unrated, no body part) sink to the bottom whatever the direction, so "highest first" and
    /// "lowest first" both start with real data. `personName` resolves ids for the person key.
    static func sort(
        _ entries: [HealthEntry],
        _ key: HealthSortKey,
        _ dir: SortDir,
        personName: @escaping (String) -> String = { $0 }
    ) -> [HealthEntry] {
        let sign = dir == .asc ? 1 : -1
        // Dates and timestamps are ISO strings, so code-point order is date order; the web's
        // localeCompare agrees on them.
        let ordinal = { (a: String, b: String) -> Int in a == b ? 0 : (a < b ? -1 : 1) }
        // Same day: by time of day (an untimed entry counts as the start of the day), then by when
        // it was typed in.
        let byDate = { (a: HealthEntry, b: HealthEntry) -> Int in
            let c = ordinal(when(b), when(a))
            return c != 0 ? c : ordinal(b.createdAt, a.createdAt)
        }
        let text = { (a: String, b: String) -> Int in
            a == b ? 0 : a.isEmpty ? 1 : b.isEmpty ? -1 : sign * localeCompare(a, b)
        }
        let num = { (a: Double?, b: Double?) -> Int in
            guard let x = a else { return b == nil ? 0 : 1 }
            guard let y = b else { return -1 }
            return x == y ? 0 : sign * (x < y ? -1 : 1)
        }
        let compare: (HealthEntry, HealthEntry) -> Int
        switch key {
        case .date: compare = { a, b in sign * ordinal(when(a), when(b)) }
        case .person: compare = { a, b in text(personName(a.personId), personName(b.personId)) }
        case .kind: compare = { a, b in sign * localeCompare(a.kind.label, b.kind.label) }
        case .title: compare = { a, b in text(a.title.lowercased(), b.title.lowercased()) }
        case .value: compare = { a, b in num(a.value, b.value) }
        case .bodyPart: compare = { a, b in text(a.bodyPart, b.bodyPart) }
        case .severity: compare = { a, b in num(a.severity.map { Double($0) }, b.severity.map { Double($0) }) }
        }
        // Array.sort makes no stability promise; the original position is the last tie-break.
        return entries.enumerated().sorted { l, r in
            var c = compare(l.element, r.element)
            if c == 0 { c = byDate(l.element, r.element) }
            return c != 0 ? c < 0 : l.offset < r.offset
        }.map { $0.element }
    }

    /// Distinct body parts and tags present in the log, sorted, for the filter pickers.
    static func facets(_ entries: [HealthEntry]) -> (bodyParts: [String], tags: [String]) {
        var bodyParts = Set<String>()
        var tags = Set<String>()
        for e in entries {
            if !e.bodyPart.isEmpty { bodyParts.insert(e.bodyPart) }
            tags.formUnion(e.tags)
        }
        return (bodyParts.sorted(), tags.sorted())
    }

    /// Runs of consecutive entries sharing a date, in the order given: the card view's day headings.
    static func groupByDate(_ entries: [HealthEntry]) -> [DayGroup] {
        var out: [DayGroup] = []
        for e in entries {
            if let last = out.indices.last, out[last].date == e.date {
                out[last].entries.append(e)
            } else {
                out.append(DayGroup(date: e.date, entries: [e]))
            }
        }
        return out
    }

    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? calendar.timeZone
        return calendar
    }()

    private static func ymd(_ y: Int, _ m: Int, _ d: Int) -> String {
        let pad = { (n: Int, width: Int) in String(repeating: "0", count: max(0, width - String(n).count)) + String(n) }
        return "\(pad(y, 4))-\(pad(m, 2))-\(pad(d, 2))"
    }

    /// `String.prototype.localeCompare`: the user's locale's collation, as -1, 0 or 1.
    private static func localeCompare(_ a: String, _ b: String) -> Int {
        switch a.localizedCompare(b) {
        case .orderedAscending: return -1
        case .orderedSame: return 0
        case .orderedDescending: return 1
        }
    }
}
