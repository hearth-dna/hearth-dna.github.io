import Foundation

/// Open formats for the user's own analysis (export/table.ts, docs/architecture/storage/open-formats.md):
/// CSV for spreadsheets, JSON Lines for scripts, written the way the web writes them, so a file
/// from the phone and one from the browser are the same bytes for the same data.
enum OpenFormat: String, CaseIterable, Identifiable {
    case csv, jsonl

    var id: String { rawValue }
    var ext: String { rawValue }
}

/// A cell: text, a number (printed as JavaScript prints it) or empty.
enum Cell: Equatable {
    case text(String)
    case number(Double)
    case null

    init(_ v: SQLValue?) {
        switch v {
        case .integer(let n)?: self = .number(Double(n))
        case .real(let d)?: self = .number(d)
        case .text(let s)?: self = .text(s)
        case .null?, nil: self = .null
        }
    }

    init(_ n: Int?) { self = n.map { .number(Double($0)) } ?? .null }
    init(_ d: Double?) { self = d.map { .number($0) } ?? .null }
}

struct Table: Equatable {
    let header: [String]
    let rows: [[Cell]]
}

enum OpenFormats {
    /// UTF-8 BOM so Excel opens accented text correctly; \n line ends (all spreadsheets accept them).
    static let csvBOM = "\u{FEFF}"

    /// `String(v)` in JavaScript.
    private static func text(_ v: Cell) -> String {
        switch v {
        case .text(let s): return s
        case .number(let n): return HealthLog.jsNumber(n)
        case .null: return ""
        }
    }

    /// JavaScript's `\s`: Unicode white space and line terminators, and the byte-order mark.
    private static func isJSSpace(_ c: Character?) -> Bool {
        guard let c else { return false }
        return c.isWhitespace || c == "\u{FEFF}"
    }

    /// RFC 4180 quoting: quote when the value has a comma, quote, newline or leading/trailing space.
    static func csvCell(_ v: Cell) -> String {
        if v == .null { return "" }
        let s = text(v)
        let needs = s.unicodeScalars.contains { $0 == "\"" || $0 == "," || $0 == "\r" || $0 == "\n" }
            || isJSSpace(s.first) || isJSSpace(s.last)
        return needs ? "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : s
    }

    static func csvLine(_ cells: [Cell]) -> String {
        cells.map(csvCell).joined(separator: ",")
    }

    /// A value as `JSON.stringify` writes it: numbers the JavaScript way, strings with its escapes.
    static func jsonValue(_ v: Cell) -> String {
        switch v {
        case .null: return "null"
        case .number(let n): return n.isFinite ? HealthLog.jsNumber(n) : "null"
        case .text(let s): return jsonString(s)
        }
    }

    static func jsonString(_ s: String) -> String {
        var out = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{8}": out += "\\b"
            case "\u{C}": out += "\\f"
            default:
                if u.value < 0x20 { out += String(format: "\\u%04x", u.value) } else { out.unicodeScalars.append(u) }
            }
        }
        return out + "\""
    }

    static func render(_ t: Table, _ format: OpenFormat) -> String {
        switch format {
        case .csv:
            return csvBOM + ([csvLine(t.header.map { .text($0) })] + t.rows.map(csvLine)).joined(separator: "\n") + "\n"
        case .jsonl:
            return t.rows.map { r in
                "{" + t.header.indices.map { jsonString(t.header[$0]) + ":" + jsonValue($0 < r.count ? r[$0] : .null) }.joined(separator: ",") + "}\n"
            }.joined()
        }
    }

    /// Column names: the person's short label, made unique with a numeric suffix.
    static func personColumns(_ persons: [Person]) -> [(id: String, name: String)] {
        var seen: [String: Int] = [:]
        return persons.map { p in
            let base = !p.label.isEmpty ? p.label : (!p.displayName.isEmpty ? p.displayName : String(p.id.prefix(8)))
            let n = seen[base] ?? 0
            seen[base] = n + 1
            return (p.id, n == 0 ? base : "\(base)-\(n + 1)")
        }
    }

    static let findingHeader = [
        "person", "rsid", "gene", "name", "genotype", "risk_allele", "risk_copies", "magnitude", "label", "evidence", "topic",
        "conditions", "drugs", "summary", "sources",
    ]

    static func findingsTable(_ byPerson: [(person: Person, findings: [Finding])]) -> Table {
        Table(header: findingHeader, rows: byPerson.flatMap { item in
            item.findings.map { f -> [Cell] in
                [
                    .text(item.person.displayName), .text(f.entry.rsid), .text(f.entry.gene), .text(f.entry.name),
                    .text(f.genotype), .text(f.entry.riskAllele), Cell(f.riskCopies), Cell(f.match?.magnitude),
                    .text(f.match?.label ?? ""), .text(f.entry.evidence), .text(f.entry.topic),
                    .text(f.entry.conditions.joined(separator: "; ")), .text(f.entry.drugs.joined(separator: "; ")),
                    .text(f.entry.summary), .text(f.entry.sources.joined(separator: " ")),
                ]
            }
        })
    }

    static let healthHeader = [
        "person", "date", "time", "kind", "title", "body_part", "severity", "value", "value2", "unit", "tags", "source", "body",
        // How many documents are attached, never their names: this file is plain text by design.
        "attachments", "created_at",
    ]

    static func healthTable(_ byPerson: [(person: Person, entries: [HealthEntry])], attachmentCounts: [String: Int] = [:]) -> Table {
        Table(header: healthHeader, rows: byPerson.flatMap { item in
            item.entries.map { e -> [Cell] in
                [
                    .text(item.person.displayName), .text(e.date), .text(e.time), .text(e.kind.rawValue), .text(e.title),
                    .text(e.bodyPart), Cell(e.severity), Cell(e.value), Cell(e.value2), .text(e.unit),
                    .text(e.tags.joined(separator: "; ")), .text(e.source), .text(e.body),
                    Cell(attachmentCounts[e.id] ?? 0), .text(e.createdAt),
                ]
            }
        })
    }

    /// One row per SNP, one genotype column per person (db.worker.ts `genotypeTable`), ordered by
    /// chromosome number then position; with `shared` only SNPs every listed person has a call for.
    static func genotypeTable(_ db: Db, _ columns: [(id: String, name: String)], shared: Bool) throws -> Table {
        let ids = columns.map { SQLValue.text($0.id) }
        let cases = columns.indices.map { ", MAX(CASE WHEN person_id = ? THEN a1 || a2 END) AS g\($0)" }.joined()
        let marks = columns.isEmpty ? "''" : Array(repeating: "?", count: columns.count).joined(separator: ",")
        let rows = try db.query(
            """
            SELECT rsid, chromosome, position\(cases) FROM genotype
            WHERE person_id IN (\(marks)) GROUP BY rsid
            \(shared ? "HAVING COUNT(*) = \(columns.count)" : "")
            ORDER BY CASE WHEN chromosome GLOB '[0-9]*' THEN CAST(chromosome AS INTEGER) ELSE 100 END, chromosome, position
            """,
            ids + ids
        )
        return Table(
            header: ["rsid", "chromosome", "position"] + columns.map(\.name),
            rows: rows.map { r in [Cell(r["rsid"]), Cell(r["chromosome"]), Cell(r["position"])] + columns.indices.map { Cell(r["g\($0)"]) } }
        )
    }

    static func fileName(_ what: String, _ format: OpenFormat) -> String {
        "hearth-\(what)-\(HealthLog.localDate()).\(format.ext)"
    }
}
