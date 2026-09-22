import SwiftUI
import UIKit

extension HealthKind {
    /// The kind's colour: `.kind-*` in `frontend/src/styles.css`, light and dark. Other uses the
    /// web's muted grey.
    var color: Color {
        switch self {
        case .symptom: return adaptive(light: 0xb4432f, dark: 0xe58a78)
        case .measurement: return adaptive(light: 0x2f6fa8, dark: 0x7fb2e5)
        case .lab: return adaptive(light: 0x7a4fb0, dark: 0xb99be0)
        case .imaging: return adaptive(light: 0x1f7f7a, dark: 0x6fc9c2)
        case .diagnosis: return adaptive(light: 0xa86a00, dark: 0xe0b35a)
        case .medication: return adaptive(light: 0x2f7d3a, dark: 0x85c98f)
        case .letter: return adaptive(light: 0x7a6446, dark: 0xc9b08c)
        case .other: return adaptive(light: 0x6b6a66, dark: 0xa09d95)
        }
    }
}

/// A severity's colour, as the web's `.mag`: amber from 4, red from 7 (`--warn`, `--danger`, which
/// the web keeps the same in dark mode).
func severityColor(_ severity: Int) -> Color {
    if severity >= 7 { return Color(uiColor: rgb(0xa8231f)) }
    if severity >= 4 { return Color(uiColor: rgb(0x9a4b00)) }
    return .primary
}

/// One colour per appearance, resolved by the system as it switches between light and dark.
private func adaptive(light: UInt32, dark: UInt32) -> Color {
    Color(uiColor: UIColor { traits in
        rgb(traits.userInterfaceStyle == .dark ? dark : light)
    })
}

private func rgb(_ hex: UInt32) -> UIColor {
    UIColor(
        red: CGFloat((hex >> 16) & 0xff) / 255,
        green: CGFloat((hex >> 8) & 0xff) / 255,
        blue: CGFloat(hex & 0xff) / 255,
        alpha: 1
    )
}

/// The kind as a tinted capsule, like the web's `.badge.kind-*`.
struct KindBadge: View {
    let kind: HealthKind

    var body: some View {
        Text(t("kind.\(kind.rawValue)"))
            .font(.caption.weight(.semibold))
            .foregroundStyle(kind.color)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(kind.color.opacity(0.1), in: Capsule())
            .overlay(Capsule().strokeBorder(kind.color.opacity(0.45)))
    }
}

/// A selectable capsule: scope, kind, period, tag and active-filter chips all use it, so they
/// read as one family of controls.
struct Chip: View {
    let label: String
    var count: Int?
    /// A coloured dot before the label (the kind chips).
    var dot: Color?
    let selected: Bool
    /// A trailing symbol, such as the remove mark on an active filter.
    var trailingSymbol: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let dot {
                    Circle().fill(dot).frame(width: 8, height: 8)
                }
                Text(label)
                if let count {
                    Text(String(count)).foregroundStyle(.secondary).monospacedDigit()
                }
                if let trailingSymbol {
                    Image(systemName: trailingSymbol).imageScale(.small)
                }
            }
            .font(.subheadline)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(selected ? Color.accentColor.opacity(0.18) : Color(uiColor: .secondarySystemFill), in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Color.accentColor : Color.clear))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
