import Foundation

/// Everything the Ask screen has loaded, per person id (items.ts).
struct AskData {
    var findingsBy: [String: [Finding]] = [:]
    var healthBy: [String: [HealthEntry]] = [:]
    /// Genotypes looked up by rsid that the knowledge base does not describe.
    var rawBy: [String: [String: Call]] = [:]
}

/// The record behind a key: exactly one of the three is set.
struct Resolved {
    let key: String
    let personId: String
    var finding: Finding?
    var call: Call?
    var health: HealthEntry?
}

enum AskItems {
    /// The record behind a key, or nil while it is not loaded (or no longer exists).
    static func resolve(_ key: String, _ d: AskData) -> Resolved? {
        guard let k = AskKey.parse(key) else { return nil }
        switch k.kind {
        case "f":
            guard let f = d.findingsBy[k.personId]?.first(where: { $0.entry.rsid == k.id }) else { return nil }
            return Resolved(key: key, personId: k.personId, finding: f)
        case "g":
            guard let c = d.rawBy[k.personId]?[k.id] else { return nil }
            return Resolved(key: key, personId: k.personId, call: c)
        default:
            guard let h = d.healthBy[k.personId]?.first(where: { $0.id == k.id }) else { return nil }
            return Resolved(key: key, personId: k.personId, health: h)
        }
    }

    /// One line for lists on the screen (the pack has its own formats).
    static func label(_ r: Resolved, undescribed: String) -> String {
        if let f = r.finding {
            return "\(f.entry.gene) \(f.entry.rsid) \(f.call.a1)/\(f.call.a2) — \(f.match?.label ?? undescribed)"
        }
        if let c = r.call {
            return "\(c.rsid) \(c.a1)/\(c.a2) (chr\(c.chromosome):\(c.position))"
        }
        return r.health.map(HealthLog.describeEntry) ?? ""
    }

    /// The pack's people: the selected ones with at least one included record, in the order of
    /// `persons` (so pseudonym letters are stable), records in the order they were added, health
    /// entries newest first as in the log.
    static func packPeople(_ keys: [String], _ d: AskData, _ persons: [Person], _ selected: [String]) -> [PackPerson] {
        let resolved = keys.compactMap { resolve($0, d) }
        return persons.filter { selected.contains($0.id) }.compactMap { person in
            let mine = resolved.filter { $0.personId == person.id }
            if mine.isEmpty { return nil }
            // A stable sort by date, then time, both descending.
            let health = mine.compactMap(\.health).enumerated().sorted { a, b in
                if a.element.date != b.element.date { return a.element.date > b.element.date }
                if a.element.time != b.element.time { return a.element.time > b.element.time }
                return a.offset < b.offset
            }.map(\.element)
            return PackPerson(
                person: person,
                findings: mine.compactMap(\.finding),
                genotypes: mine.compactMap(\.call),
                health: health
            )
        }
    }
}
