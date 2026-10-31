import SwiftUI

/// The body map's figures and the tooth chart's layout, from `body-figures.json` (built from the
/// web's drawing by frontend/src/components/mobileFigures.ts, copied in by `make mobile-assets`):
/// every figure already reshaped for its age group and placed in one scene, its paths in M, L, C, Q
/// and Z only. Loaded once; the screens draw what this reads and ask it which part a tap landed on.
final class BodyFigures {
    struct Region {
        let part: String
        /// "left" or "right" for one side of a paired part, else "".
        let side: String
        /// "front" or "back".
        let view: String
        /// Drawn over the body (an organ, a feature of the face), as an outline until it has entries.
        let overlay: Bool
        /// x0, y0, x1, y1 in the scene.
        let box: [CGFloat]
        let path: Path

        func contains(_ p: CGPoint) -> Bool {
            p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3] && path.contains(p, eoFill: true)
        }
    }

    struct Spot: Decodable {
        let n: Int
        let x: CGFloat
        let y: CGFloat
        let angle: Double
        let size: CGFloat
    }

    private struct File: Decodable {
        struct Scene: Decodable {
            let w: CGFloat
            let h: CGFloat
            let mid: [String: CGFloat]
        }
        struct Raw: Decodable {
            let part: String
            let side: String
            let view: String
            let overlay: Bool?
            let box: [CGFloat]
            let d: [String]
        }
        struct TeethLayout: Decodable {
            let w: CGFloat
            let h: CGFloat
            let permanent: [Spot]
            let milk: [Spot]
        }
        let scene: Scene
        let figures: [String: [Raw]]
        let teeth: TeethLayout
    }

    static let shared: BodyFigures? = {
        guard let url = Bundle.main.url(forResource: "body-figures", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? BodyFigures(data)
    }()

    let width: CGFloat
    let height: CGFloat
    /// Each view's midline in the scene.
    let mid: [String: CGFloat]
    let teethWidth: CGFloat
    let teethHeight: CGFloat
    let permanent: [Spot]
    let milk: [Spot]
    private let raw: [String: [File.Raw]]
    private var built: [String: [Region]] = [:]

    init(_ data: Data) throws {
        let f = try JSONDecoder().decode(File.self, from: data)
        width = f.scene.w
        height = f.scene.h
        mid = f.scene.mid
        raw = f.figures
        teethWidth = f.teeth.w
        teethHeight = f.teeth.h
        permanent = f.teeth.permanent
        milk = f.teeth.milk
    }

    /// One figure: "male" or "female", and an age group from `Anatomy.stages`. Drawn in list order.
    func regions(_ sex: String, _ stage: String) -> [Region] {
        let key = raw["\(sex)-\(stage)"] == nil ? "male-adult" : "\(sex)-\(stage)"
        if let done = built[key] { return done }
        let regions = (raw[key] ?? []).map { r in
            Region(
                part: r.part, side: r.side, view: r.view, overlay: r.overlay ?? false, box: r.box,
                path: r.d.reduce(into: Path()) { p, d in p.addPath(BodyFigures.path(d)) }
            )
        }
        built[key] = regions
        return regions
    }

    /// Every part some figure draws; the rest go under "elsewhere".
    lazy var drawn: Set<String> = Set(raw.values.joined().map(\.part))

    /// The region a point in the scene falls on: the last drawn, as that is the one on top.
    static func regionAt(_ regions: [Region], _ p: CGPoint) -> Region? { regions.last { $0.contains(p) } }

    /// Where to look for a picked part (BodyMap.tsx `zoomOn`): its regions on the front where it has
    /// any (else the back), one side only when a side is picked; centre and a zoom of at most five.
    func zoom(_ regions: [Region], part: String, side: String) -> (center: CGPoint, scale: CGFloat)? {
        let all = regions.filter { $0.part == part && (side.isEmpty || $0.side == side) }
        let view = all.contains { $0.view == "front" } ? "front" : "back"
        let boxes = all.filter { $0.view == view }.map(\.box)
        guard let x0 = boxes.map({ $0[0] }).min(), let y0 = boxes.map({ $0[1] }).min(),
              let x1 = boxes.map({ $0[2] }).max(), let y1 = boxes.map({ $0[3] }).max() else { return nil }
        let s = min(5, width / (x1 - x0 + 240), height / (y1 - y0 + 240))
        return (CGPoint(x: (x0 + x1) / 2, y: (y0 + y1) / 2), s)
    }

    /// Path data in M, L, C, Q and Z, all absolute.
    static func path(_ d: String) -> Path {
        var p = Path()
        var tokens: [Substring] = []
        var i = d.startIndex
        while i < d.endIndex {
            let c = d[i]
            if "MLCQZ".contains(c) {
                tokens.append(d[i...i])
                i = d.index(after: i)
            } else if c == "-" || c == "." || c.isNumber {
                var j = d.index(after: i)
                while j < d.endIndex, d[j].isNumber || d[j] == "." { j = d.index(after: j) }
                tokens.append(d[i..<j])
                i = j
            } else {
                i = d.index(after: i)
            }
        }
        var k = 0
        var cmd: Substring = ""
        func num() -> CGFloat {
            defer { k += 1 }
            return CGFloat(Double(tokens[k]) ?? 0)
        }
        func pt() -> CGPoint {
            let x = num()
            return CGPoint(x: x, y: num())
        }
        while k < tokens.count {
            if let f = tokens[k].first, f.isLetter {
                cmd = tokens[k]
                k += 1
            }
            switch cmd {
            case "M":
                p.move(to: pt())
                cmd = "L"
            case "L":
                p.addLine(to: pt())
            case "C":
                let c1 = pt()
                let c2 = pt()
                p.addCurve(to: pt(), control1: c1, control2: c2)
            case "Q":
                let c = pt()
                p.addQuadCurve(to: pt(), control: c)
            case "Z":
                p.closeSubpath()
                cmd = ""
            default:
                k += 1
            }
        }
        return p
    }
}
