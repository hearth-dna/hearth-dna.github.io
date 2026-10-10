import Foundation

/// One genotype's reading in the knowledge base.
struct KbGenotype: Equatable {
    let label: String
    let magnitude: Double
}

struct KbEntry: Identifiable, Equatable {
    let rsid: String
    let gene: String
    let name: String
    let riskAllele: String
    let evidence: String
    let summary: String
    /// Keyed by the normalised genotype (`normGenotype`: alleles sorted, "CT" not "TC").
    let genotypes: [String: KbGenotype]
    let sources: [String]
    let drugs: [String]
    let conditions: [String]
    let topic: String
    let generatedBy: String
    /// Area ids (`Kb.areas`), at least one in the shipped file.
    var areas: [String] = []

    var id: String { rsid }
}

/// An area of medicine the DNA tab filters by (kb/reviewed/areas.json); `en` is always present.
struct KbArea: Equatable, Identifiable {
    let id: String
    let names: [String: String]

    func name(_ lang: String = "en") -> String { names[lang] ?? names["en"] ?? id }
}

/// A topic and its category (`clinical` or `lifestyle`), which ranks the DNA tab.
struct KbTopic: Equatable {
    let id: String
    let category: String
}

/// An entry of the condition catalogue (kb/reviewed/conditions.json): names and synonyms in several
/// languages. The kb's entries and the health log refer to a condition by `id`; `en` is always present.
struct KbCondition: Equatable, Identifiable {
    let id: String
    let names: [String: String]
    var synonyms: [String: [String]] = [:]

    func name(_ lang: String = "en") -> String { names[lang] ?? names["en"] ?? id }

    /// Every name and synonym of the condition, in every language.
    var allNames: [String] { Array(names.values) + synonyms.values.flatMap { $0 } }
}

/// The bundled knowledge base (frontend/public/kb.json, built by kb/build_kb.py) and the logic over
/// it: a port of frontend/src/kb/kb.ts and sortFindings.ts. The file ships inside the app, copied to
/// `Hearth/Resources/kb.json` by `make mobile-kb`; nothing is fetched.
struct Kb: Equatable {
    let version: String
    let entries: [KbEntry]
    var topics: [KbTopic] = []
    var areas: [KbArea] = []
    var conditions: [KbCondition] = []

    static let empty = Kb(version: "", entries: [])

    func condition(_ id: String) -> KbCondition? { conditions.first { $0.id == id } }

    /// The English name for a condition id, or the id itself when the kb does not know it.
    func conditionLabel(_ id: String) -> String { condition(id)?.name() ?? id }

    /// Every name and synonym of the conditions an entry is linked to.
    func conditionNames(_ e: KbEntry) -> [String] { e.conditions.flatMap { condition($0)?.allNames ?? [] } }

    /// The copy in the app bundle, read once. A build made without `make mobile-kb` has none, and
    /// gets an empty kb (no findings, no search hits) rather than a crash.
    static let bundled: Kb = {
        guard let url = Bundle.main.url(forResource: "kb", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let kb = try? Kb.parse(data)
        else { return .empty }
        return kb
    }()

    /// kb.json as the Android port reads it: missing optional fields are empty, a missing
    /// magnitude is 0.
    static func parse(_ data: Data) throws -> Kb {
        let file = try JSONDecoder().decode(File.self, from: data)
        return Kb(
            version: file.version ?? "",
            entries: file.entries.map { e in
                KbEntry(
                    rsid: e.rsid,
                    gene: e.gene,
                    name: e.name ?? "",
                    riskAllele: e.risk_allele ?? "",
                    evidence: e.evidence ?? "",
                    summary: e.summary ?? "",
                    genotypes: e.genotypes.mapValues { KbGenotype(label: $0.label ?? "", magnitude: $0.magnitude ?? 0) },
                    sources: e.sources ?? [],
                    drugs: e.drugs ?? [],
                    conditions: e.conditions ?? [],
                    topic: e.topic ?? "",
                    generatedBy: e.generated_by ?? "",
                    areas: e.areas ?? []
                )
            },
            topics: (file.topics ?? []).map { KbTopic(id: $0.id, category: $0.category ?? "") },
            areas: (file.areas ?? []).map { KbArea(id: $0.id, names: $0.names) },
            conditions: (file.conditions ?? []).map { KbCondition(id: $0.id, names: $0.names, synonyms: $0.synonyms ?? [:]) }
        )
    }

    // The file's own field names, snake_case as build_kb.py writes them.
    private struct File: Decodable {
        struct Genotype: Decodable {
            let label: String?
            let magnitude: Double?
        }

        struct Entry: Decodable {
            let rsid: String
            let gene: String
            let name: String?
            let risk_allele: String?
            let evidence: String?
            let summary: String?
            let genotypes: [String: Genotype]
            let sources: [String]?
            let drugs: [String]?
            let conditions: [String]?
            let topic: String?
            let generated_by: String?
            let areas: [String]?
        }

        struct Topic: Decodable {
            let id: String
            let category: String?
        }

        struct Area: Decodable {
            let id: String
            let names: [String: String]
        }

        struct Condition: Decodable {
            let id: String
            let names: [String: String]
            let synonyms: [String: [String]]?
        }

        let version: String?
        let entries: [Entry]
        let topics: [Topic]?
        let areas: [Area]?
        let conditions: [Condition]?
    }
}

/// "TC" and "CT" are the same genotype; the kb keys it with the alleles sorted.
func normGenotype(_ a1: String, _ a2: String) -> String {
    [a1, a2].sorted().joined()
}

/// A person's call at a marker the kb describes. `match` is nil when the kb does not describe the
/// genotype they carry.
struct Finding: Identifiable, Equatable {
    let entry: KbEntry
    let genotype: String
    let call: Call
    let match: KbGenotype?
    let riskCopies: Int

    var id: String { entry.rsid }
}

/// "12.0" → "12", "2.5" → "2.5": magnitudes shown the way JavaScript prints numbers.
func plainNumber(_ d: Double) -> String {
    if d == d.rounded() && d.isFinite && abs(d) < 1e15 { return String(Int64(d)) }
    return String(d)
}

/// `localeCompare`, which the web's sorts use.
private func collate(_ a: String, _ b: String) -> ComparisonResult {
    a.localizedCompare(b)
}

/// A stable sort: Kotlin's and JavaScript's sorts keep equal elements in order, Swift's does not.
private func stableSorted<T>(_ items: [T], _ ascending: (T, T) -> ComparisonResult) -> [T] {
    items.enumerated().sorted { x, y in
        switch ascending(x.element, y.element) {
        case .orderedAscending: return true
        case .orderedDescending: return false
        case .orderedSame: return x.offset < y.offset
        }
    }.map(\.element)
}

private func compare<V: Comparable>(_ a: V, _ b: V) -> ComparisonResult {
    a < b ? .orderedAscending : (a > b ? .orderedDescending : .orderedSame)
}

enum KbLogic {
    /// Joins a person's calls against the kb, highest impact first. A genotype the kb does not
    /// describe still gives a finding, with no match.
    static func computeFindings(_ kb: Kb, _ calls: [Call]) -> [Finding] {
        var byRsid: [String: KbEntry] = [:]
        for e in kb.entries where byRsid[e.rsid] == nil { byRsid[e.rsid] = e }
        var out: [Finding] = []
        for c in calls {
            guard let entry = byRsid[c.rsid], c.a1 != "-" else { continue }
            let genotype = normGenotype(c.a1, c.a2 == "-" ? c.a1 : c.a2)
            let riskCopies = (c.a1 == entry.riskAllele ? 1 : 0) + (c.a2 == entry.riskAllele ? 1 : 0)
            out.append(Finding(entry: entry, genotype: genotype, call: c, match: entry.genotypes[genotype], riskCopies: riskCopies))
        }
        return stableSorted(out) { a, b in
            let byMagnitude = compare(b.match?.magnitude ?? 0, a.match?.magnitude ?? 0)
            return byMagnitude != .orderedSame ? byMagnitude : collate(a.entry.evidence, b.entry.evidence)
        }
    }

    /// Text search over the kb: rsid, gene, name, summary, drugs, and every name of the linked conditions.
    static func search(_ kb: Kb, _ q: String) -> [KbEntry] {
        let needle = q.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if needle.isEmpty { return [] }
        return kb.entries.filter { e in
            ([e.rsid, e.gene, e.name, e.summary] + e.drugs + kb.conditionNames(e)).contains { $0.lowercased().contains(needle) }
        }
    }

    /// Stable sort by `key`; ties fall back to impact (descending) then gene, so the order is
    /// deterministic.
    static func sortFindings(_ findings: [Finding], _ key: FindingSortKey, ascending: Bool) -> [Finding] {
        func magnitude(_ f: Finding) -> Double { f.match?.magnitude ?? -1 }
        func gene(_ a: Finding, _ b: Finding) -> ComparisonResult {
            let g = collate(a.entry.gene, b.entry.gene)
            return g != .orderedSame ? g : collate(a.entry.rsid, b.entry.rsid)
        }
        func by(_ a: Finding, _ b: Finding) -> ComparisonResult {
            switch key {
            case .gene: return gene(a, b)
            case .topic: return collate(a.entry.topic, b.entry.topic)
            case .evidence: return collate(a.entry.evidence, b.entry.evidence)
            case .riskCopies: return compare(a.riskCopies, b.riskCopies)
            case .magnitude: return compare(magnitude(a), magnitude(b))
            }
        }
        return stableSorted(findings) { a, b in
            let primary = ascending ? by(a, b) : by(b, a)
            if primary != .orderedSame { return primary }
            let impact = compare(magnitude(b), magnitude(a))
            return impact != .orderedSame ? impact : gene(a, b)
        }
    }
}

/// The findings table's sortable columns, in the web's order, each with the direction it starts in.
enum FindingSortKey: CaseIterable, Identifiable {
    case gene, riskCopies, topic, evidence, magnitude

    var id: Self { self }

    var defaultAscending: Bool {
        switch self {
        case .gene, .topic, .evidence: return true
        case .riskCopies, .magnitude: return false
        }
    }

    /// i18n key of the column it sorts (`personPage.json`).
    var labelKey: String {
        switch self {
        case .gene: return "personPage.colGene"
        case .riskCopies: return "personPage.colGenotype"
        case .topic: return "personPage.colMeaning"
        case .evidence: return "personPage.colEvidence"
        case .magnitude: return "personPage.colImpact"
        }
    }
}
