import Foundation

/// One person's part of a pack: kb findings, genotypes the kb does not describe (looked up by
/// rsid), and health-log entries, newest first.
struct PackPerson {
    let person: Person
    let findings: [Finding]
    var genotypes: [Call] = []
    var health: [HealthEntry] = []
}

struct PackOptions {
    let question: String
    let people: [PackPerson]
    let realNames: Bool
    /// The calendar year ages are computed in (the web's `now.getFullYear()`).
    let year: Int
    var template: PromptTemplate?
    var compact = false
    var evidence = true
    var appName = "Hearth"
}

struct PackStats: Equatable {
    let chars: Int
    let tokens: Int
    let genotypes: Int
    let healthEntries: Int
}

/// The copy-out context pack (contextPack.ts, docs/design.md §6.3), character for character, so the
/// same selection gives the same text in every app. Pure and deterministic: the preview is exactly
/// what is copied. Pseudonymised by default: labels instead of names, ages rounded to five years.
/// Compact mode puts every record on one line, shortens long text and folds repeated measurements
/// into one series.
enum ContextPack {
    /// Longest free text kept per health entry in compact mode.
    static let compactText = 240

    /// `Math.round`: halves go up, as in JavaScript.
    private static func jsRound(_ x: Double) -> Int { Int((x + 0.5).rounded(.down)) }

    static func label(_ p: Person, _ i: Int, realNames: Bool, year: Int) -> String {
        // "Person A", "Person B"…: `String.fromCharCode(65 + i)`, as the web writes it.
        let letter = Unicode.Scalar(UInt32(65 + i)).map { String($0) } ?? "?"
        var parts = [realNames ? p.displayName : "Person \(letter)"]
        if p.sex != "unknown" { parts.append(p.sex) }
        if let born = p.birthYear, born != 0 {
            let age = year - born
            parts.append(realNames ? "\(age)" : "about \(jsRound(Double(age) / 5) * 5)")
        }
        return parts.joined(separator: ", ")
    }

    static func build(_ o: PackOptions) -> String {
        var lines: [String] = []
        lines.append("# Context for a health question (generated locally by \(o.appName); informational, not medical advice)")
        lines.append("")
        for (i, pp) in o.people.enumerated() {
            lines.append("## \(label(pp.person, i, realNames: o.realNames, year: o.year))")
            if o.compact { compactPerson(pp, &lines) } else { fullPerson(pp, &lines) }
            lines.append("")
        }
        var seen = Set<String>()
        var evidence: [String] = []
        if o.evidence {
            for pp in o.people {
                for f in pp.findings where seen.insert(f.entry.rsid).inserted {
                    let sources = o.compact ? Array(f.entry.sources.prefix(1)) : f.entry.sources
                    evidence.append("- \(f.entry.name): \(f.entry.summary) Sources: \(sources.joined(separator: ", "))")
                }
            }
        }
        if !evidence.isEmpty {
            lines.append("## Evidence notes (from the local knowledge base)")
            lines.append(contentsOf: evidence)
            lines.append("")
        }
        lines.append("## Question")
        let question = jsTrim(o.question)
        lines.append(question.isEmpty ? "(no question entered)" : question)
        lines.append("")
        lines.append("## Instructions for the assistant")
        if let template = o.template { lines.append(template.text) }
        lines.append(Prompts.assistantInstructions)
        return lines.joined(separator: "\n")
    }

    private static func fullPerson(_ pp: PackPerson, _ lines: inout [String]) {
        if pp.findings.isEmpty && pp.genotypes.isEmpty { lines.append("- (no relevant genotypes selected)") }
        for f in pp.findings {
            let e = f.entry
            let status = f.match?.label ?? "genotype not described in knowledge base"
            lines.append("- \(e.gene) \(e.rsid) (\(e.name)): \(f.call.a1)/\(f.call.a2) — \(status) [evidence \(e.evidence)]")
        }
        for c in pp.genotypes {
            lines.append("- \(c.rsid) (chr\(c.chromosome):\(c.position)): \(c.a1)/\(c.a2) — not in the knowledge base")
        }
        if !pp.health.isEmpty {
            lines.append("### Health log (the person's documents and self-reported symptoms, dated)")
            for h in pp.health {
                // Foundation replaces UTF-16 "\n" units, as JavaScript does, even inside "\r\n".
                let body = jsTrim(h.body).replacingOccurrences(of: "\n", with: "\n  ")
                lines.append("- \(HealthLog.describeEntry(h))\(body.isEmpty ? "" : "\n  \(body)")")
            }
        }
    }

    /// Whitespace and line breaks collapsed, cut at `max` characters (UTF-16 units, as JavaScript
    /// counts them) with an ellipsis.
    static func squeeze(_ text: String, _ max: Int = ContextPack.compactText) -> String {
        var acc = ""
        for piece in splitOnNewlines(text) {
            let l = jsTrim(piece)
            if l.isEmpty { continue }
            if acc.isEmpty {
                acc = l
            } else {
                let ends = acc.last.map { ".;:!?".contains($0) } ?? false
                acc += (ends ? " " : "; ") + l
            }
        }
        let flat = acc.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        let units = Array(flat.utf16)
        if units.count <= max { return flat }
        let cut = String(decoding: units.prefix(max - 1), as: UTF16.self)
        return trimEnd(cut) + "…"
    }

    private static func compactPerson(_ pp: PackPerson, _ lines: inout [String]) {
        if !pp.findings.isEmpty || !pp.genotypes.isEmpty {
            lines.append("Genotypes:")
            for f in pp.findings {
                let e = f.entry
                let status = f.match?.label ?? "not described in knowledge base"
                lines.append("- \(e.gene) \(e.rsid) \(f.call.a1)/\(f.call.a2): \(status) [evidence \(e.evidence)]")
            }
            for c in pp.genotypes {
                lines.append("- \(c.rsid) \(c.a1)/\(c.a2) (chr\(c.chromosome):\(c.position); not in knowledge base)")
            }
        }
        if pp.health.isEmpty { return }
        lines.append("Health log:")
        // Measurements of the same thing in the same unit become one series line, oldest first,
        // placed where the newest of them would have been.
        func seriesKey(_ h: HealthEntry) -> String { "\(jsTrim(h.title).lowercased())\u{0}\(h.unit)" }
        func isSeries(_ h: HealthEntry) -> Bool { h.kind == .measurement && h.value != nil }
        var series: [String: [HealthEntry]] = [:]
        for h in pp.health where isSeries(h) { series[seriesKey(h), default: []].append(h) }
        var done = Set<String>()
        for h in pp.health {
            if isSeries(h), let group = series[seriesKey(h)], group.count > 1 {
                if !done.insert(seriesKey(h)).inserted { continue }
                let points = group.reversed().map { m -> String in
                    let note = squeeze(m.body, 60)
                    return "\(HealthLog.when(m)) \(bareValue(m))\(note.isEmpty ? "" : " (\(note))")"
                }.joined(separator: "; ")
                lines.append("- \(h.title)\(h.unit.isEmpty ? "" : ", \(h.unit)") (\(group.count) readings): \(points)")
                continue
            }
            let value = HealthLog.formatValue(h)
            let extra = [h.bodyPart, h.severity.map { "severity \($0)/10" } ?? "", HealthLog.formatTags(h.tags)]
                .filter { !$0.isEmpty }
            let body = squeeze(h.body)
            var line = "- \(HealthLog.when(h)) \(h.kind.rawValue): \(h.title)"
            if !value.isEmpty { line += " \(value)" }
            if !extra.isEmpty { line += " (\(extra.joined(separator: "; ")))" }
            if !body.isEmpty { line += " — \(body)" }
            lines.append(line)
        }
    }

    /// `formatValue` without the unit: the series line names it once.
    private static func bareValue(_ h: HealthEntry) -> String {
        guard let v = h.value else { return "" }
        return h.value2.map { "\(HealthLog.jsNumber(v))/\(HealthLog.jsNumber($0))" } ?? HealthLog.jsNumber(v)
    }

    /// Counts for the preview, the confirmation and the sharing log.
    static func stats(_ people: [PackPerson], _ pack: String) -> PackStats {
        let chars = pack.utf16.count
        return PackStats(
            chars: chars,
            // Rough: English-like text runs about four characters per token in common tokenisers.
            tokens: (chars + 3) / 4,
            genotypes: people.reduce(0) { $0 + $1.findings.count + $1.genotypes.count },
            healthEntries: people.reduce(0) { $0 + $1.health.count }
        )
    }

    // MARK: - JavaScript string behaviour

    /// `String.prototype.trim`: whitespace and line terminators at both ends.
    static func jsTrim(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func trimEnd(_ s: String) -> String {
        var out = s
        while let last = out.unicodeScalars.last, CharacterSet.whitespacesAndNewlines.contains(last) {
            out.unicodeScalars.removeLast()
        }
        return out
    }

    /// `split(/\n+/)` on UTF-16 units, so a "\r\n" (one Swift Character) still splits, leaving the
    /// "\r" for the trim, as in JavaScript.
    private static func splitOnNewlines(_ s: String) -> [String] {
        var out: [String] = []
        var current = String.UnicodeScalarView()
        for scalar in s.unicodeScalars {
            if scalar == "\n" {
                out.append(String(current))
                current = String.UnicodeScalarView()
            } else {
                current.append(scalar)
            }
        }
        out.append(String(current))
        return out
    }
}
