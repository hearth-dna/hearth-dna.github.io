import SwiftUI

/// How one tooth is drawn: its fill, its number's colour, and whether it is outlined.
struct ToothLook {
    let fill: Color
    let text: Color
    let outlined: Bool
}

/// Both jaws, the person's right on the viewer's left, permanent or milk teeth (ToothChart.tsx
/// `Jaws`), from the layout in body-figures.json; each tooth a button.
private struct Jaws: View {
    let milk: Bool
    let look: (Int) -> ToothLook
    let onTap: (Int) -> Void

    var body: some View {
        if let figures = BodyFigures.shared {
            let spots = milk ? figures.milk : figures.permanent
            let w = figures.teethWidth
            let h = figures.teethHeight
            GeometryReader { geo in
                let k = geo.size.width / w
                ZStack(alignment: .topLeading) {
                    jawLabel(t("detail.teeth.upper"), x: w / 2, y: h / 2 - 34, k: k)
                    jawLabel(t("detail.teeth.lower"), x: w / 2, y: h / 2 + 36, k: k)
                    jawLabel("← " + t("detail.teeth.right"), x: w / 2 - 70, y: h / 2, k: k)
                    jawLabel(t("detail.teeth.left") + " →", x: w / 2 + 70, y: h / 2, k: k)
                    ForEach(spots, id: \.n) { s in
                        let l = look(s.n)
                        let shape = RoundedRectangle(cornerRadius: s.size * 0.6 * k)
                        ZStack {
                            shape.fill(l.fill)
                            shape.stroke(l.outlined ? Color.primary : Color.secondary.opacity(0.5), lineWidth: l.outlined ? 2.5 : 1)
                        }
                        .frame(width: s.size * 2 * k, height: s.size * 1.9 * k)
                        .rotationEffect(.degrees(s.angle))
                        .overlay(Text(String(s.n)).font(.caption2).monospacedDigit().foregroundStyle(l.text))
                        .contentShape(Rectangle())
                        .position(x: s.x * k, y: s.y * k)
                        .onTapGesture { onTap(s.n) }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(name(s.n))
                        .accessibilityAddTraits(l.outlined ? [.isButton, .isSelected] : .isButton)
                    }
                }
            }
            .aspectRatio(w / h, contentMode: .fit)
            .frame(maxWidth: 420)
        }
    }

    private func jawLabel(_ text: String, x: CGFloat, y: CGFloat, k: CGFloat) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary).fixedSize().position(x: x * k, y: y * k)
    }

    private func name(_ n: Int) -> String {
        t(Teeth.isMilk(n) ? "detail.teeth.milkTooth" : "detail.teeth.tooth", ["n": n, "type": t("detail.teeth.\(Teeth.type(n))")])
    }
}

/// The permanent / milk teeth switch.
private struct MilkSwitch: View {
    @Binding var milk: Bool

    var body: some View {
        Picker(t("detail.teeth"), selection: $milk) {
            Text(t("detail.teeth.permanent")).tag(false)
            Text(t("detail.teeth.milk")).tag(true)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
    }
}

/// Pick the teeth a dental entry is about (ToothChart.tsx): FDI numbers, permanent and milk teeth
/// on separate charts with their own numbers; what is picked on either stays picked when switching.
struct ToothPicker: View {
    @Binding var teeth: [Int]
    @State private var milk: Bool

    init(teeth: Binding<[Int]>, milkFirst: Bool) {
        _teeth = teeth
        let picked = teeth.wrappedValue
        let permanent = picked.filter { !Teeth.isMilk($0) }
        _milk = State(initialValue: picked.contains(where: Teeth.isMilk) ? permanent.isEmpty || milkFirst : milkFirst && permanent.isEmpty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(t("detail.teeth")).font(.subheadline.weight(.semibold))
            HStack {
                MilkSwitch(milk: $milk)
                if !teeth.isEmpty {
                    Button(t("detail.teeth.clear")) { teeth = [] }
                }
            }
            Jaws(
                milk: milk,
                look: { n in
                    teeth.contains(n)
                        ? ToothLook(fill: .accentColor, text: .white, outlined: false)
                        : ToothLook(fill: Color(uiColor: .systemBackground), text: .primary, outlined: false)
                },
                onTap: { n in teeth = Teeth.toggle(teeth, n) }
            )
            Text(teeth.isEmpty ? t("detail.teeth.hint") : Teeth.text(teeth))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// The teeth on the body map's mouth (ToothChart.tsx `ToothHeat`): each coloured by how many entries
/// name it, the picked one outlined; picking one filters to it, picking it again lets go.
struct ToothHeat: View {
    let counts: [Int: Int]
    let picked: Int?
    let milkFirst: Bool
    /// The colour for a count.
    let color: (Int) -> Color
    let onPick: (Int?) -> Void
    @State private var milk = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(t("detail.teeth")).font(.headline)
                MilkSwitch(milk: $milk)
            }
            Jaws(
                milk: milk,
                look: { n in ToothLook(fill: color(counts[n] ?? 0), text: .primary, outlined: picked == n) },
                onTap: { n in onPick(picked == n ? nil : n) }
            )
            Text(t(counts.isEmpty ? "bodyMap.noTeeth" : "bodyMap.teethHint"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .onChange(of: milkFirst, initial: true) { _, first in milk = first }
    }
}
