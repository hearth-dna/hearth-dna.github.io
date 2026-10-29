import SwiftUI

/// A quick bar folded to its label until tapped open (QuickBar.tsx), so the log stays in view.
struct QuickBar<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 8) { content }
                .padding(.top, 8)
        } label: {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
        }
        .padding(12)
        .background(
            Color(uiColor: .secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
    }
}
