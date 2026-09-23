import Foundation

/// What the document reader returns and what the add form is prefilled with (documents/draft.ts).
/// The user reviews and edits it before anything is saved; model output is never stored unseen.
struct HealthDraft: Equatable {
    let date: String
    let kind: HealthKind
    let title: String
    let body: String
}

enum DocumentDraft {
    /// What the user says the document is; "auto" lets the model decide.
    static let hints = ["auto", "lab", "imaging", "letter", "medication", "diagnosis"]

    /// The instruction sent with the pages. Transcription only: no interpretation, no advice.
    static func prompt(_ hint: String) -> String {
        let what = hint == "auto" ? "a medical document" : "a \((HealthKind(rawValue: hint) ?? .other).label.lowercased())"
        return [
            "The attached pages are \(what) belonging to the user. Transcribe it faithfully into the JSON schema.",
            "date: the document date in YYYY-MM-DD, or \"\" if not printed. kind: one of lab, imaging, letter, medication, diagnosis, other.",
            "title: a short label (test panel, modality and body region, or letter subject).",
            "body: the findings and conclusion in the document's own words, translated to English if needed, preserving the original wording of the conclusion. Do not add interpretation, risk statements or advice.",
            "values: every measured value as {name, value, unit, ref} for lab sheets; empty otherwise. Keep names as printed.",
            "Leave out patient name, date of birth, address, insurance and record numbers.",
        ].joined(separator: " ")
    }

    /// Gemini `responseSchema` (an OpenAPI subset), the same object the web sends.
    static func schema() -> [String: Any] {
        let str: [String: Any] = ["type": "string"]
        let value: [String: Any] = [
            "type": "object",
            "properties": ["name": str, "value": str, "unit": str, "ref": str],
            "required": ["name", "value"],
        ]
        return [
            "type": "object",
            "properties": [
                "date": str,
                "kind": ["type": "string", "enum": ["lab", "imaging", "letter", "medication", "diagnosis", "other"]] as [String: Any],
                "title": str,
                "body": str,
                "values": ["type": "array", "items": value] as [String: Any],
            ] as [String: Any],
            "required": ["date", "kind", "title", "body", "values"],
        ]
    }

    /// A JSON value as text, as the Kotlin port's `optString` gives it: missing or null is "".
    private static func text(_ v: Any?) -> String {
        switch v {
        case let s as String: return s
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
            return HealthLog.jsNumber(n.doubleValue)
        default: return ""
        }
    }

    /// The model's JSON as a draft: tolerant of missing fields, strict about the kind and the date.
    static func fromJSON(_ json: String, fallbackDate: String) throws -> HealthDraft {
        guard let j = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
            throw Egress.Failure.empty
        }
        let values = j["values"] as? [Any] ?? []
        let lines: [String] = values.compactMap { item in
            guard let v = item as? [String: Any] else { return nil }
            let name = text(v["name"])
            if name.isEmpty || v["value"] == nil { return nil }
            let unit = text(v["unit"])
            let ref = text(v["ref"])
            return "\(name): \(text(v["value"]))\(unit.isEmpty ? "" : " \(unit)")\(ref.isEmpty ? "" : " (ref \(ref))")"
        }
        let body = [text(j["body"]).trimmingCharacters(in: .whitespacesAndNewlines), lines.joined(separator: "\n")]
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
        let date = text(j["date"])
        let isDate = date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
        let title = text(j["title"]).trimmingCharacters(in: .whitespacesAndNewlines)
        return HealthDraft(
            date: isDate ? date : fallbackDate,
            kind: HealthKind(rawValue: text(j["kind"])) ?? .other,
            title: title.isEmpty ? "Untitled document" : title,
            body: body
        )
    }
}
