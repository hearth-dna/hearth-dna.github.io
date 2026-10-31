import Foundation

/// Port of frontend/src/health/body.ts: which body part each entry names, and how many entries each
/// part (each side of a paired part, each tooth) has, for the body map's heat. AnatomyTests mirrors
/// body.test.ts.
enum Anatomy {
    /// Paired parts: drawn once per side, and filterable by side.
    static let paired: Set<String> = [
        "eyes", "ears", "lungs", "shoulders", "armpit", "hips", "arms", "elbows", "wrists", "hands", "fingers",
        "legs", "knees", "ankles", "feet",
    ]

    private static let known = Set(BODY_PARTS)
    private static let singular = ["foot": "feet", "tooth": "mouth", "teeth": "mouth"]

    /// The body part an entry names: one of `BODY_PARTS` when it is one ("Knee" → "knees"), else the
    /// text lower-cased.
    static func key(_ text: String) -> String {
        let k = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        if k.isEmpty || known.contains(k) { return k }
        if let s = singular[k] { return s }
        if known.contains(k + "s") { return k + "s" }
        return k
    }

    /// Whether an entry on `side` belongs to the map's `want` side: its own, both sides, or none recorded.
    static func onSide(_ side: String, _ want: String) -> Bool {
        want.isEmpty || side == want || side == "both" || side.isEmpty
    }

    struct Heat {
        /// Entries per part, as `key` names it.
        var parts: [String: Int] = [:]
        /// Of those, the ones on each side, for paired parts.
        var left: [String: Int] = [:]
        var right: [String: Int] = [:]
        /// The largest count of any drawn part or side (at least 1): the top of the colour scale.
        var max = 1

        /// How many entries one region stands for: the part, or one side of a paired part.
        func count(_ part: String, _ side: String = "") -> Int {
            switch side {
            case "left": return left[part] ?? 0
            case "right": return right[part] ?? 0
            default: return parts[part] ?? 0
            }
        }
    }

    static func heat(_ entries: [HealthEntry]) -> Heat {
        var h = Heat()
        for e in entries {
            let k = key(e.bodyPart)
            if k.isEmpty { continue }
            h.parts[k, default: 0] += 1
            guard paired.contains(k) else { continue }
            if onSide(e.side, "left") { h.left[k, default: 0] += 1 }
            if onSide(e.side, "right") { h.right[k, default: 0] += 1 }
        }
        for (k, n) in h.parts {
            h.max = Swift.max(h.max, paired.contains(k) ? Swift.max(h.left[k] ?? 0, h.right[k] ?? 0) : n)
        }
        return h
    }

    /// Steps of the colour scale; 0 is "none".
    static let steps = 5

    /// 0 for none, else 1–`steps` in proportion to the busiest part.
    static func level(_ n: Int, _ max: Int) -> Int {
        n <= 0 ? 0 : Swift.max(1, Int((Double(n) / Double(Swift.max(max, 1)) * Double(steps)).rounded(.up)))
    }

    /// Entries per tooth (FDI number), from the teeth dental entries name.
    static func teethHeat(_ entries: [HealthEntry]) -> [Int: Int] {
        var out: [Int: Int] = [:]
        for e in entries { for n in Teeth.of(e.details) { out[n, default: 0] += 1 } }
        return out
    }

    /// Age groups the map draws (frontend/src/components/bodyWarp.ts `STAGES`), oldest first.
    static let stages = ["adult", "teen", "child", "young", "toddler"]
    private static let from: [String: Double] = ["adult": 16, "teen": 13, "child": 9, "young": 4, "toddler": 0]

    /// The age group for an age in years; adult when unknown.
    static func stage(_ age: Double?) -> String {
        guard let age else { return "adult" }
        return stages.first { age >= from[$0]! } ?? "toddler"
    }

    /// Age in years from a birth year alone (the phones keep no birth date), counted from mid-year.
    static func age(birthYear: Int?, today: Date = Date()) -> Double? {
        guard let birthYear,
              let mid = Calendar(identifier: .gregorian).date(from: DateComponents(year: birthYear, month: 7, day: 1))
        else { return nil }
        return today.timeIntervalSince(mid) / (365.25 * 86_400)
    }
}
