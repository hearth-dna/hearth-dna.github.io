import Foundation

/// What kind of question this is, from its words alone (intent.ts): rules, not a model, and every
/// type says which words triggered it, so the recommendation can explain itself.
enum QuestionType: String, CaseIterable {
    case medication, labs, symptoms, family, doctor, report, genetics

    var id: String { rawValue }

    /// The prompt template this type of question gets by default.
    var template: String {
        switch self {
        case .medication: return "medication"
        case .labs: return "labs"
        case .symptoms: return "symptoms"
        case .family: return "compare"
        case .doctor: return "doctor"
        case .report: return "second-opinion"
        case .genetics: return "explain"
        }
    }
}

struct Intent: Equatable {
    let type: QuestionType
    let signals: [String]
}

enum IntentClassifier {
    /// A question word matches a stem of five or more letters it starts with ("prescribed" ←
    /// "prescri"), or a shorter entry exactly ("mom" must not match "moment"). Entries with a space
    /// are phrases.
    private static let signalWords: [QuestionType: [String]] = [
        .medication: [
            "medicat", "medicine", "drug", "drugs", "dose", "doses", "dosage", "pill", "pills", "tablet", "prescri", "side effect",
            "interaction", "statin", "antidepressant", "painkiller", "antibiotic", "supplement", "metaboli", "taking", "mg",
        ],
        .labs: [
            "lab", "labs", "blood test", "test result", "result", "cholesterol", "ldl", "hdl", "triglycerid", "glucose", "hba1c",
            "ferritin", "vitamin", "iron", "tsh", "crp", "creatinin", "reference range", "level", "panel", "trend",
        ],
        .symptoms: [
            "symptom", "pain", "painful", "ache", "aches", "aching", "hurt", "hurts", "fever", "headache", "migraine", "tired",
            "fatigue", "rash", "cough", "dizzy", "dizziness", "nause", "swell", "itch", "itchy", "sleep", "insomnia", "feel",
            "feeling", "sore", "stiff", "temperature", "blood pressure", "weight",
        ],
        .family: [
            "inherit", "heredit", "parent", "mother", "father", "mom", "dad", "child", "son", "sons", "daughter", "sibling",
            "brother", "sister", "family", "carrier", "pass on", "passed on", "compare", "both of", "kids",
        ],
        .doctor: [
            "doctor", "appointment", "visit", "clinician", "physician", "specialist", "gp", "cardiologist", "rheumatologist",
            "what to ask", "questions to ask", "prepare",
        ],
        .report: [
            "report", "second opinion", "letter", "diagnos", "conclusion", "discharge", "scan", "scans", "mri", "x-ray", "ultrasound",
        ],
        .genetics: [
            "gene", "genes", "genetic", "variant", "snp", "snps", "genotype", "dna", "mutation", "allele", "risk", "risks", "predispos",
        ],
    ]

    /// Ties go to the more specific type.
    private static let order: [QuestionType] = [.medication, .labs, .symptoms, .report, .doctor, .family, .genetics]

    /// Lower-cased words: runs of letters, digits, `*` and `-` (`/[^\p{L}\p{N}*-]+/u`).
    static func words(_ text: String) -> [String] {
        var out: [String] = []
        var current = ""
        for s in text.lowercased().unicodeScalars {
            if isWordScalar(s) {
                current.unicodeScalars.append(s)
            } else if !current.isEmpty {
                out.append(current)
                current = ""
            }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    private static func isWordScalar(_ s: Unicode.Scalar) -> Bool {
        if s == "*" || s == "-" { return true }
        switch s.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }

    private static func isRsid(_ w: String) -> Bool {
        guard w.hasPrefix("rs"), w.count > 2 else { return false }
        return w.dropFirst(2).allSatisfy { $0.isASCII && $0.isNumber }
    }

    private static func hits(_ question: String, _ stems: [String]) -> [String] {
        let q = question.lowercased()
        let ws = words(question)
        var out: [String] = []
        for stem in stems {
            let found: String?
            if stem.contains(" ") {
                found = q.contains(stem) ? stem : nil
            } else {
                found = ws.first { $0 == stem || (stem.count >= 5 && $0.hasPrefix(stem)) }
            }
            if let found, !out.contains(found) { out.append(found) }
        }
        return out
    }

    /// Every type the question shows signals for, strongest first. Knowledge-base names count too:
    /// a kb drug is a medication signal, a gene symbol or rsid a genetics one, a body part a symptom
    /// one. Asking about two or more selected people adds a family signal.
    static func classify(_ question: String, _ kb: Kb, peopleSelected: Int = 1) -> [Intent] {
        var ws: [String] = []
        for w in words(question) where !ws.contains(w) { ws.append(w) }
        let wordSet = Set(ws)
        var extra: [QuestionType: [String]] = [:]
        for e in kb.entries {
            for d in e.drugs where wordSet.contains(d.lowercased()) { extra[.medication, default: []].append(d.lowercased()) }
            if wordSet.contains(e.gene.lowercased()) { extra[.genetics, default: []].append(e.gene) }
            if wordSet.contains(e.rsid) { extra[.genetics, default: []].append(e.rsid) }
        }
        for w in ws where isRsid(w) && !(extra[.genetics] ?? []).contains(w) { extra[.genetics, default: []].append(w) }
        let lower = question.lowercased()
        for b in BODY_PARTS where lower.contains(b) { extra[.symptoms, default: []].append(b) }
        if peopleSelected >= 2 { extra[.family, default: []].append("several people") }

        let intents: [Intent] = order.compactMap { type in
            var found: [String] = []
            for s in hits(question, signalWords[type] ?? []) + (extra[type] ?? []) where !found.contains(s) { found.append(s) }
            return found.isEmpty ? nil : Intent(type: type, signals: found)
        }
        // Stable: equal counts keep `order`, which `intents` is already in.
        return intents.enumerated().sorted { a, b in
            a.element.signals.count != b.element.signals.count
                ? a.element.signals.count > b.element.signals.count
                : a.offset < b.offset
        }.map(\.element)
    }
}
