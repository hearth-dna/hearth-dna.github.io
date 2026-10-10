import Foundation

/// The DNA tab's model: a port of frontend/src/kb/viewer.ts. Every marker the knowledge base
/// describes, most clinically useful first, filtered by area of medicine, text and notability, with
/// each selected person's genotype beside it. Pure.
enum Viewer {
    /// Impact at or above which a genotype counts as notable (the Ask screen uses the same bar).
    static let notable = 2.0

    private static func maxMagnitude(_ e: KbEntry) -> Double {
        max(0, e.genotypes.values.map(\.magnitude).max() ?? 0)
    }

    private static func order<V: Comparable>(_ a: V, _ b: V) -> ComparisonResult {
        a < b ? .orderedAscending : (a > b ? .orderedDescending : .orderedSame)
    }

    /// Clinical value, best first: evidence grade (A before C), then medical topics before
    /// lifestyle ones, then the largest impact any genotype of the marker can have, then gene.
    static func rankEntries(_ kb: Kb) -> [KbEntry] {
        let clinical = Set(kb.topics.filter { $0.category == "clinical" }.map(\.id))
        let isClinical = { (e: KbEntry) in clinical.contains(e.topic) ? 1 : 0 }
        // A stable sort: JavaScript's and Kotlin's keep equal elements in order, Swift's does not.
        return kb.entries.enumerated().sorted { l, r in
            let a = l.element, b = r.element
            let steps: [() -> ComparisonResult] = [
                { a.evidence.localizedCompare(b.evidence) },
                { order(isClinical(b), isClinical(a)) },
                { order(maxMagnitude(b), maxMagnitude(a)) },
                { a.gene.localizedCompare(b.gene) },
                { a.rsid.localizedCompare(b.rsid) },
            ]
            for step in steps {
                let c = step()
                if c != .orderedSame { return c == .orderedAscending }
            }
            return l.offset < r.offset
        }.map(\.element)
    }

    struct Filter: Equatable {
        /// Area ids; a marker in any of them is shown. Empty: every area.
        var areas: [String] = []
        var query = ""
        /// Only markers where a shown person has a notable genotype.
        var notable = false
    }

    struct Row: Identifiable {
        let entry: KbEntry
        /// Per shown person id; absent when the person was not genotyped for this marker.
        let findings: [String: Finding]

        var id: String { entry.rsid }
    }

    static func rows(_ kb: Kb, _ findingsBy: [String: [Finding]], _ personIds: [String], _ f: Filter) -> [Row] {
        let hits: Set<String>? = f.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? nil : Set(KbLogic.search(kb, f.query).map(\.rsid))
        return rankEntries(kb)
            .filter { f.areas.isEmpty || $0.areas.contains { f.areas.contains($0) } }
            .filter { hits == nil || hits!.contains($0.rsid) }
            .map { entry in
                var found: [String: Finding] = [:]
                for id in personIds {
                    if let hit = findingsBy[id]?.first(where: { $0.entry.rsid == entry.rsid }) { found[id] = hit }
                }
                return Row(entry: entry, findings: found)
            }
            .filter { r in !f.notable || r.findings.values.contains { ($0.match?.magnitude ?? 0) >= notable } }
    }

    /// The rows as context-pack people: each shown person with their genotypes for these markers.
    static func packPeople(_ rows: [Row], _ people: [Person]) -> [PackPerson] {
        people.map { p in PackPerson(person: p, findings: rows.compactMap { $0.findings[p.id] }) }.filter { !$0.findings.isEmpty }
    }

    /// The question the pack asks when the user leaves it empty, in English like the rest of the pack.
    static func question(_ kb: Kb, _ areas: [String]) -> String {
        let names = kb.areas.filter { areas.contains($0.id) }.map { $0.name().lowercased() }
        return names.isEmpty
            ? "What do these genotypes mean, and what, if anything, is worth acting on or checking?"
            : "What do these genotypes mean for \(names.joined(separator: ", "))? What, if anything, is worth acting on or checking?"
    }
}
