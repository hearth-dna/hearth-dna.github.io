import Foundation

/// Per-rsid inheritance and the pedigree layout: a port of frontend/src/family/inheritance.ts. Pure;
/// the drawing is UI/Pedigree.swift.
enum Inheritance {
    /// Where an allele came from when no parent can be named.
    enum Origin {
        static let ambiguous = "ambiguous"
        static let untyped = "untyped"
        static let impossible = "impossible"
    }

    /// An allele and where it came from: a parent id, or one of `Origin`'s reasons.
    struct AlleleOrigin: Equatable {
        let allele: String
        let from: String
    }

    struct ParentCall {
        let id: String
        let call: Call?
    }

    private static func has(_ call: Call?, _ allele: String) -> Bool {
        guard let call else { return false }
        return call.a1 == allele || call.a2 == allele
    }

    /// Phases a child's genotype against up to two parents. With two typed parents an allele is
    /// attributed when exactly one parental assignment explains the pair (or the child is
    /// homozygous); with one typed parent when the parent carries one allele and not the other.
    /// Everything else is ambiguous; a pair no assignment explains is impossible (a Mendelian
    /// violation).
    static func alleleOrigins(_ child: Call, _ parents: [ParentCall]) -> [AlleleOrigin] {
        let c1 = child.a1
        let c2 = child.a2
        func both(_ x: String, _ y: String) -> [AlleleOrigin] {
            [AlleleOrigin(allele: c1, from: x), AlleleOrigin(allele: c2, from: y)]
        }
        if c1 == "-" || c2 == "-" { return [] }
        let typed = parents.filter { $0.call != nil && $0.call?.a1 != "-" }
        if typed.isEmpty { return both(Origin.untyped, Origin.untyped) }
        if typed.count == 1 {
            let p = typed[0]
            let other = parents.first { $0.id != p.id }?.id ?? Origin.untyped
            let h1 = has(p.call, c1)
            let h2 = has(p.call, c2)
            if !h1 && !h2 { return both(Origin.impossible, Origin.impossible) }
            if c1 == c2 { return both(p.id, other) }
            if h1 && h2 { return both(Origin.ambiguous, Origin.ambiguous) }
            return h1 ? both(p.id, other) : both(other, p.id)
        }
        let a = typed[0]
        let b = typed[1]
        let ab = has(a.call, c1) && has(b.call, c2) // c1 from a, c2 from b
        let ba = has(a.call, c2) && has(b.call, c1) // c2 from a, c1 from b
        if !ab && !ba { return both(Origin.impossible, Origin.impossible) }
        if c1 == c2 || (ab && !ba) { return both(a.id, b.id) }
        if ba && !ab { return both(b.id, a.id) }
        return both(Origin.ambiguous, Origin.ambiguous)
    }

    /// One person's place in the drawing: row, slot within the row, and their parents' ids.
    struct PedigreeNode: Identifiable, Equatable {
        let person: Person
        let generation: Int
        let column: Int
        let parents: [String]

        var id: String { person.id }
    }

    /// Generation = longest ancestor chain (founders 0), then co-parents are pulled down to the
    /// same row so a spouse who married in sits beside their partner rather than among the
    /// grandparents. Within a generation people are ordered by the mean column of their parents (or
    /// of their co-parent's parents), so children sit under them; ties keep creation order.
    static func layoutPedigree(_ persons: [Person], _ relationships: [Relationship]) -> [PedigreeNode] {
        // Insertion-ordered, like the Kotlin LinkedHashMaps, so every run lays out the same way.
        var parentsOf: [String: [String]] = [:]
        var children: [String] = []
        for r in relationships {
            if parentsOf[r.childId] == nil { children.append(r.childId) }
            parentsOf[r.childId, default: []].append(r.parentId)
        }
        var gen: [String: Int] = [:]
        func depth(_ id: String, _ seen: inout Set<String>) -> Int {
            if let known = gen[id] { return known }
            // Cycle guard: the UI never creates one, but a backup might.
            if !seen.insert(id).inserted { return 0 }
            let ps = parentsOf[id] ?? []
            let d = ps.isEmpty ? 0 : ps.map { depth($0, &seen) }.max()! + 1
            gen[id] = d
            return d
        }
        for p in persons {
            var seen = Set<String>()
            _ = depth(p.id, &seen)
        }
        var coParentsOf: [String: [String]] = [:]
        var coParentOrder: [String] = []
        for child in children {
            let ps = parentsOf[child] ?? []
            for a in ps {
                for b in ps where a != b {
                    if coParentsOf[a] == nil { coParentOrder.append(a) }
                    if !(coParentsOf[a] ?? []).contains(b) { coParentsOf[a, default: []].append(b) }
                }
            }
        }
        // Fixpoint: co-parents share a row, children stay below every parent. Bounded for cyclic
        // backups.
        var changed = true
        var guardCount = persons.count * 2
        while changed && guardCount > 0 {
            guardCount -= 1
            changed = false
            func lift(_ id: String, _ to: Int) {
                if (gen[id] ?? 0) < to {
                    gen[id] = to
                    changed = true
                }
            }
            for a in coParentOrder {
                for b in coParentsOf[a] ?? [] { lift(a, gen[b] ?? 0) }
            }
            for child in children {
                let ps = parentsOf[child] ?? []
                lift(child, (ps.map { gen[$0] ?? 0 }.max() ?? 0) + 1)
            }
        }
        var col: [String: Int] = [:]
        let byGeneration = Dictionary(grouping: persons) { gen[$0.id] ?? 0 }
        var out: [PedigreeNode] = []
        let last = byGeneration.keys.max() ?? 0
        for g in 0...max(last, 0) {
            func mean(_ ids: [String]) -> Double {
                let cs = ids.compactMap { col[$0] }
                return cs.isEmpty ? .infinity : Double(cs.reduce(0, +)) / Double(cs.count)
            }
            func key(_ p: Person) -> Double {
                let own = mean(parentsOf[p.id] ?? [])
                if own != .infinity { return own }
                return mean((coParentsOf[p.id] ?? []).flatMap { parentsOf[$0] ?? [] })
            }
            // A stable sort on (key, created_at): ties keep the caller's order, as Kotlin's does.
            let row = (byGeneration[g] ?? []).enumerated().map { (offset: $0.offset, person: $0.element, key: key($0.element)) }
                .sorted { x, y in
                    if x.key != y.key { return x.key < y.key }
                    if x.person.createdAt != y.person.createdAt { return x.person.createdAt < y.person.createdAt }
                    return x.offset < y.offset
                }
                .map(\.person)
            for (i, p) in row.enumerated() {
                col[p.id] = i
                out.append(PedigreeNode(person: p, generation: g, column: i, parents: parentsOf[p.id] ?? []))
            }
        }
        // The caller's order, as the web returns it.
        var index: [String: Int] = [:]
        for (i, p) in persons.enumerated() where index[p.id] == nil { index[p.id] = i }
        return out.sorted { (index[$0.person.id] ?? 0) < (index[$1.person.id] ?? 0) }
    }
}
