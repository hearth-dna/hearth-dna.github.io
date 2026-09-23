import Foundation

/// Which knowledge-base entries a free-text question is about (retrieve.ts). Matches gene symbols,
/// marker names, rsids, drugs and conditions only, never summary prose, and ignores a stop list so
/// "with", "about", "should" cannot pull in unrelated markers.
enum Retrieve {
    private static let stop: Set<String> = Set(
        "the for you did has had was not his her him she who why its our out get got see use used now new too off own about above after again against all also and any are around because been before being below between both but can could does doing down during each even ever every from further have having here how into just like more most much need only other over same should since some such than that their them then there these they this those through under until very were what when where which while will with within without would your yours does dont should worry given compare status risk gene genes variant variants family member members mother father parent parents child children"
            .split(separator: " ").map(String.init)
    )

    /// Lower-cased, split on everything but ASCII letters, digits and `*` (`/[^a-z0-9*]+/`).
    static func tokens(_ text: String) -> [String] {
        var out: [String] = []
        var current = ""
        for s in text.lowercased().unicodeScalars {
            if (s >= "a" && s <= "z") || (s >= "0" && s <= "9") || s == "*" {
                current.unicodeScalars.append(s)
            } else if !current.isEmpty {
                out.append(current)
                current = ""
            }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    /// The question's words worth matching, in order, without repeats.
    static func questionTerms(_ question: String) -> [String] {
        var seen = Set<String>()
        return tokens(question).filter { $0.count >= 3 && !stop.contains($0) && seen.insert($0).inserted }
    }

    private static func entryTerms(_ e: KbEntry) -> [String] {
        ([e.rsid, e.gene, e.name] + e.drugs + e.conditions).flatMap(tokens).filter { $0.count >= 3 }
    }

    /// The rsids of the entries the question names, in kb order.
    static func forQuestion(_ kb: Kb, _ question: String) -> [String] {
        let terms = questionTerms(question)
        if terms.isEmpty { return [] }
        var hits: [String] = []
        for e in kb.entries where !hits.contains(e.rsid) {
            let et = entryTerms(e)
            // Whole-token match, or a term that is a prefix of a token of 5+ letters (statin → statins).
            let match = terms.contains { t in
                et.contains { w in w == t || (t.count >= 5 && w.hasPrefix(t)) || (w.count >= 5 && t.hasPrefix(w)) }
            }
            if match { hits.append(e.rsid) }
        }
        return hits
    }
}
