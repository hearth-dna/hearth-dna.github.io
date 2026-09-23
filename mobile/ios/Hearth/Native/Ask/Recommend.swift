import Foundation

/// One record that can go into a context pack (recommend.ts). Keys are stable strings so the screen
/// can keep an ordered selection: `f:<person>:<rsid>` a kb finding, `g:<person>:<rsid>` a genotype
/// the kb does not describe, `h:<person>:<entry id>` a health-log entry.
enum AskKey {
    static func finding(_ personId: String, _ rsid: String) -> String { "f:\(personId):\(rsid)" }
    static func genotype(_ personId: String, _ rsid: String) -> String { "g:\(personId):\(rsid)" }
    static func health(_ personId: String, _ id: String) -> String { "h:\(personId):\(id)" }

    struct Parsed: Equatable {
        let kind: Character
        let personId: String
        let id: String
    }

    /// `^([fgh]):([^:]+):(.+)$`: the person id runs to the second colon, the id takes the rest.
    static func parse(_ key: String) -> Parsed? {
        let parts = key.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
        guard parts.count == 3, let kind = parts[0].first, parts[0].count == 1, "fgh".contains(kind),
              !parts[1].isEmpty, !parts[2].isEmpty
        else { return nil }
        return Parsed(kind: kind, personId: String(parts[1]), id: String(parts[2]))
    }
}

/// Why a record is suggested; the screen turns it into a sentence.
enum Reason: Equatable {
    case mentioned(String)
    case pharmacogenomic
    case notable
    case sharedVariant
    case matchesQuestion(String)
    case recent(HealthKind)
}

struct Suggestion: Equatable {
    let key: String
    let personId: String
    let reason: Reason
}

/// One person's records: kb findings, and health entries newest first as the repository returns
/// them.
struct PersonRecords {
    let personId: String
    let findings: [Finding]
    let health: [HealthEntry]
}

enum Recommend {
    /// What each question type pulls from the health log: kind, how many, how far back in days.
    private static let healthPlan: [QuestionType: [(kind: HealthKind, n: Int, days: Int)]] = [
        .medication: [(.medication, 10, 365), (.diagnosis, 5, 3650)],
        .labs: [(.lab, 10, 730), (.medication, 5, 365)],
        .symptoms: [(.symptom, 10, 90), (.measurement, 15, 30), (.medication, 5, 90), (.diagnosis, 3, 3650)],
        .family: [(.diagnosis, 5, 3650)],
        .doctor: [(.symptom, 8, 60), (.diagnosis, 5, 3650), (.medication, 8, 365), (.lab, 5, 365)],
        .report: [(.letter, 3, 365), (.imaging, 3, 365), (.diagnosis, 3, 3650)],
        .genetics: [],
    ]

    private static func magnitude(_ f: Finding) -> Double { f.match?.magnitude ?? 0 }

    /// Up to `n` newest entries of a kind, preferring those within `days` of `now`; when none is
    /// that recent the newest ones still count (a lab panel from last year beats no lab panel).
    private static func newest(_ entries: [HealthEntry], _ kind: HealthKind, _ n: Int, _ days: Int, _ now: Date) -> [HealthEntry] {
        let of = entries.filter { $0.kind == kind }
        let cutoff = utcDate(now.addingTimeInterval(-Double(days) * 86_400))
        let recent = of.filter { $0.date >= cutoff }
        return Array((recent.isEmpty ? of : recent).prefix(n))
    }

    /// YYYY-MM-DD in UTC, as the Kotlin port and the web's `toISOString().slice(0, 10)` give it.
    private static func utcDate(_ d: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let c = calendar.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Records worth including for this question, per person, most relevant first and without
    /// duplicates: kb entries named in the question, health entries whose words match it, then
    /// what the question types call for (pharmacogenomic markers for medication, recent labs for
    /// lab questions, variants several people share for family questions…).
    static func recommend(
        _ kb: Kb, _ question: String, _ intents: [Intent], _ people: [PersonRecords], now: Date = Date()
    ) -> [Suggestion] {
        var out: [Suggestion] = []
        var seen = Set<String>()
        func add(_ key: String, _ personId: String, _ reason: Reason) {
            if seen.insert(key).inserted { out.append(Suggestion(key: key, personId: personId, reason: reason)) }
        }
        var types: [QuestionType] = []
        for i in intents where !types.contains(i.type) { types.append(i.type) }
        let mentioned = Set(Retrieve.forQuestion(kb, question))
        // Health text is prose: only words of four letters or more are specific enough to match on.
        let patterns: [(term: String, regex: NSRegularExpression)] = Retrieve.questionTerms(question)
            .filter { $0.count >= 4 }
            .compactMap { term in
                (try? NSRegularExpression(pattern: #"\b"# + NSRegularExpression.escapedPattern(for: term))).map { (term: term, regex: $0) }
            }
        // Variants at least two selected people carry with some impact.
        var carriers: [String: Int] = [:]
        for p in people {
            for f in p.findings where magnitude(f) > 0 { carriers[f.entry.rsid, default: 0] += 1 }
        }

        for p in people {
            for f in p.findings where mentioned.contains(f.entry.rsid) {
                add(AskKey.finding(p.personId, f.entry.rsid), p.personId, .mentioned(f.entry.gene))
            }
            for e in p.health {
                let text = ([e.title, e.bodyPart] + e.tags + [e.body]).joined(separator: " ").lowercased()
                let range = NSRange(location: 0, length: (text as NSString).length)
                if let hit = patterns.first(where: { $0.regex.firstMatch(in: text, range: range) != nil }) {
                    add(AskKey.health(p.personId, e.id), p.personId, .matchesQuestion(hit.term))
                }
            }
            if types.contains(.medication) {
                for f in p.findings where f.entry.topic == "pharmacogenomics" && magnitude(f) > 0 {
                    add(AskKey.finding(p.personId, f.entry.rsid), p.personId, .pharmacogenomic)
                }
            }
            if types.contains(.family) {
                for f in p.findings where (carriers[f.entry.rsid] ?? 0) >= 2 {
                    add(AskKey.finding(p.personId, f.entry.rsid), p.personId, .sharedVariant)
                }
            }
            for type in types {
                for plan in healthPlan[type] ?? [] {
                    for e in newest(p.health, plan.kind, plan.n, plan.days, now) {
                        add(AskKey.health(p.personId, e.id), p.personId, .recent(plan.kind))
                    }
                }
            }
            // Notable markers when nothing more specific came from the kb.
            if (types.contains(.genetics) || types.contains(.doctor) || types.contains(.labs)) && mentioned.isEmpty {
                for f in p.findings where magnitude(f) >= 2 {
                    add(AskKey.finding(p.personId, f.entry.rsid), p.personId, .notable)
                }
            }
        }
        return out
    }
}
