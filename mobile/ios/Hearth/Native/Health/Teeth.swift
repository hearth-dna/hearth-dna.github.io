import Foundation

/// Port of frontend/src/health/teeth.ts. Teeth by their FDI (ISO 3950) number: quadrants 1–4 hold
/// the 32 permanent teeth (11–48), quadrants 5–8 the 20 milk teeth (51–85), so the number alone says
/// whether a tooth is a milk tooth. An entry stores its teeth in `details` as `{"teeth":"16 26 55"}`.
enum Teeth {
    private static func rows(_ right: (Int, Int), _ left: (Int, Int), _ n: Int) -> [[Int]] {
        [
            (1...n).reversed().map { right.0 * 10 + $0 } + (1...n).map { left.0 * 10 + $0 },
            (1...n).reversed().map { right.1 * 10 + $0 } + (1...n).map { left.1 * 10 + $0 },
        ]
    }

    /// [upper jaw, lower jaw], each the person's right → left.
    static let permanent = rows((1, 4), (2, 3), 8)
    static let milk = rows((5, 8), (6, 7), 5)

    private static let all = Set(permanent.joined()).union(milk.joined())

    static func isMilk(_ n: Int) -> Bool { n / 10 >= 5 }

    /// "26 16 x 16 99 55,19" → [16, 26, 55]: valid FDI numbers only, ascending, each once.
    static func parse(_ v: String?) -> [Int] {
        let numbers = (v ?? "").split(whereSeparator: { " ,;\t\n".contains($0) }).compactMap { Int($0) }
        return Array(Set(numbers.filter { all.contains($0) })).sorted()
    }

    /// Inverse of `parse`; "" when there are none.
    static func format(_ teeth: [Int]) -> String { teeth.sorted().map(String.init).joined(separator: " ") }

    /// Adds the tooth, or takes it out when it is already there.
    static func toggle(_ teeth: [Int], _ n: Int) -> [Int] {
        teeth.contains(n) ? teeth.filter { $0 != n } : (teeth + [n]).sorted()
    }

    /// What kind of tooth it is: incisor, canine, premolar or molar (the `detail.teeth.*` keys).
    static func type(_ n: Int) -> String {
        let i = n % 10
        if i <= 2 { return "incisor" }
        if i == 3 { return "canine" }
        return isMilk(n) || i >= 6 ? "molar" : "premolar"
    }

    /// The teeth an entry names, from its `details` JSON; empty when none or unreadable.
    static func of(_ details: String) -> [Int] {
        guard !details.isEmpty, let data = details.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
        return parse(obj["teeth"] as? String)
    }

    /// `details` holding these teeth, as the web writes it (`{"teeth":"16 26"}`); "" when none.
    static func details(_ teeth: [Int]) -> String {
        guard !teeth.isEmpty else { return "" }
        let value = format(teeth).replacingOccurrences(of: "\"", with: "")
        return "{\"teeth\":\"\(value)\"}"
    }

    /// "Teeth 16, 26 · Milk teeth 55", translated; "" when there are none.
    static func text(_ teeth: [Int]) -> String {
        let permanent = teeth.filter { !isMilk($0) }
        let milk = teeth.filter(isMilk)
        let list = { (ns: [Int]) in ns.map(String.init).joined(separator: ", ") }
        return [
            permanent.isEmpty ? "" : t("detail.teethShort", ["list": list(permanent)]),
            milk.isEmpty ? "" : t("detail.milkShort", ["list": list(milk)]),
        ].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}
