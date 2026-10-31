import SwiftUI

/// The colour steps of the map, 0 (none: the body's own tone) to `Anatomy.steps`: one hue, the web's
/// `--series-2`, over the background (styles.css `.heat-*`).
enum HeatColors {
    static let orange = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0xD9 / 255, green: 0x59 / 255, blue: 0x26 / 255, alpha: 1)
            : UIColor(red: 0xEB / 255, green: 0x68 / 255, blue: 0x34 / 255, alpha: 1)
    })
    private static let strength: [Double] = [0, 0.18, 0.36, 0.55, 0.75, 1]
    static let base = Color.primary.opacity(0.14)

    /// The colour of a step; laid over the background, so step 1 is a tint and step 5 the full hue.
    static func color(_ level: Int) -> Color {
        level <= 0 ? base : orange.opacity(strength[min(level, strength.count - 1)])
    }
}

/// The health log on a body (BodyMap.tsx): a front and a back figure, male or female, shaped for the
/// age group; each part (each side of a paired one) coloured by how many of the shown entries name
/// it. A tap on a part zooms in on it and filters the log to it; on the mouth the teeth get the same
/// colours, and a tooth can be picked too. Parts with no place on the figure are chips below.
struct BodyMapView: View {
    let heat: Anatomy.Heat
    let teeth: [Int: Int]
    /// The shown person's sex and age group; either can be switched here.
    let sex: String
    let stage: String
    /// The picked part (`Anatomy.key`) and side; "" for none.
    let part: String
    let side: String
    let tooth: Int?
    let onPick: (_ part: String, _ side: String) -> Void
    let onTooth: (Int?) -> Void

    @State private var shownSex = "male"
    @State private var shownStage = "adult"

    var body: some View {
        if let figures = BodyFigures.shared {
            content(figures)
                .onChange(of: sex, initial: true) { _, s in shownSex = s }
                .onChange(of: stage, initial: true) { _, s in shownStage = s }
        }
    }

    private var picked: String { Anatomy.key(part) }

    private func name(_ p: String) -> String { BODY_PARTS.contains(p) ? t("bodyPart.\(p)") : p }

    private func label(_ p: String, _ s: String, _ n: Int) -> String {
        t("bodyMap.region", ["part": s.isEmpty ? name(p) : "\(name(p)) · \(t("side.\(s)"))", "n": n])
    }

    private func pick(_ p: String, _ s: String) {
        if p == picked && s == side { onPick("", "") } else { onPick(p, s) }
    }

    @ViewBuilder
    private func content(_ figures: BodyFigures) -> some View {
        let regions = figures.regions(shownSex, shownStage)
        let child = shownStage != "adult"
        let teethMax = max(heat.max, teeth.values.max() ?? 0)
        let other = heat.parts.keys.filter { !figures.drawn.contains($0) }.sorted()
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(picked.isEmpty ? t("bodyMap.hint") : label(picked, side, heat.count(picked, side)))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                if !picked.isEmpty {
                    Button(t("bodyMap.zoomOut")) { onPick("", "") }.font(.subheadline)
                }
            }
            HStack {
                Picker(t("bodyMap.title"), selection: $shownSex) {
                    Text(t(child ? "bodyMap.boy" : "bodyMap.male")).tag("male")
                    Text(t(child ? "bodyMap.girl" : "bodyMap.female")).tag("female")
                }
                .pickerStyle(.segmented)
                Picker(t("bodyMap.age"), selection: $shownStage) {
                    ForEach(Anatomy.stages, id: \.self) { s in Text(t("bodyMap.stage.\(s)")).tag(s) }
                }
            }
            figure(figures, regions)
            if picked.isEmpty {
                // Under each figure: which side of the person is which; front at a quarter, back at three.
                HStack(spacing: 0) {
                    ForEach(Array(["bodyMap.r", "bodyMap.front", "bodyMap.l", "bodyMap.l", "bodyMap.back", "bodyMap.r"].enumerated()), id: \.offset) { _, key in
                        Text(t(key)).font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                    }
                }
            }
            if picked == "mouth" {
                ToothHeat(
                    counts: teeth,
                    picked: tooth,
                    milkFirst: shownStage == "toddler" || shownStage == "young" || (!teeth.isEmpty && teeth.keys.allSatisfy { $0 > 50 }),
                    color: { n in n == 0 ? Color(uiColor: .systemBackground) : HeatColors.color(Anatomy.level(n, teethMax)) },
                    onPick: onTooth
                )
            }
            HStack(spacing: 4) {
                Text(t("bodyMap.fewer")).font(.caption2).foregroundStyle(.secondary)
                ForEach(1...Anatomy.steps, id: \.self) { l in
                    RoundedRectangle(cornerRadius: 3).fill(HeatColors.color(l)).frame(width: 14, height: 14)
                }
                Text(t("bodyMap.more", ["n": picked == "mouth" ? teethMax : heat.max])).font(.caption2).foregroundStyle(.secondary)
            }
            if !other.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Text(t("bodyMap.elsewhere")).font(.caption).foregroundStyle(.secondary)
                        ForEach(other, id: \.self) { p in
                            let n = heat.parts[p] ?? 0
                            Chip(label: name(p), count: n, dot: HeatColors.color(Anatomy.level(n, heat.max)), selected: p == picked) {
                                pick(p, "")
                            }
                        }
                    }
                }
            }
        }
        .padding(.horizontal)
    }

    /// Both figures, zoomed on the picked part: the drawing is scaled and moved as a whole, so the
    /// zoom animates; a tap is read in the drawing's own coordinates.
    private func figure(_ figures: BodyFigures, _ regions: [BodyFigures.Region]) -> some View {
        let zoom = picked.isEmpty ? nil : figures.zoom(regions, part: picked, side: side)
        let s = zoom?.scale ?? 1
        let center = zoom?.center ?? CGPoint(x: figures.width / 2, y: figures.height / 2)
        return GeometryReader { geo in
            let k = geo.size.width / figures.width
            Canvas { ctx, _ in
                ctx.scaleBy(x: k, y: k)
                let thin = 1 / (k * s)
                for r in regions {
                    let level = Anatomy.level(heat.count(r.part, r.side), heat.max)
                    let on = r.part == picked && (side.isEmpty || r.side.isEmpty || r.side == side)
                    if r.overlay && level == 0 {
                        ctx.stroke(r.path, with: .color(.secondary), style: StrokeStyle(lineWidth: thin, dash: [4 * thin, 3 * thin]))
                    } else {
                        if level > 0 { ctx.fill(r.path, with: .color(Color(uiColor: .systemBackground))) }
                        ctx.fill(r.path, with: .color(HeatColors.color(level)))
                    }
                    if on { ctx.stroke(r.path, with: .color(.primary), lineWidth: 1.5 * thin) }
                }
            }
            .frame(width: geo.size.width, height: geo.size.width * figures.height / figures.width)
            .contentShape(Rectangle())
            .onTapGesture { loc in
                let p = CGPoint(x: loc.x / k, y: loc.y / k)
                if let hit = BodyFigures.regionAt(regions, p) { pick(hit.part, hit.side) } else if !picked.isEmpty { onPick("", "") }
            }
            .scaleEffect(s, anchor: .topLeading)
            .offset(x: geo.size.width / 2 - center.x * k * s, y: geo.size.height / 2 - center.y * k * s)
            .animation(.easeInOut(duration: 0.35), value: "\(picked)|\(side)|\(shownSex)|\(shownStage)")
        }
        .aspectRatio(figures.width / figures.height, contentMode: .fit)
        .clipped()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(t("bodyMap.title"))
        .accessibilityValue(picked.isEmpty ? "" : label(picked, side, heat.count(picked, side)))
    }
}
