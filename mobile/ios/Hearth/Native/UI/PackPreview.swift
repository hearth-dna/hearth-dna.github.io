import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Where a context pack can go; an assistant is named by its id, which is also what the log records.
private enum PackDestination: Equatable {
    case clipboard
    case share
    case assistant(Assistant)
}

/// The system share sheet with the pack as text; `onDone` says whether anything was shared.
private struct ActivityView: UIViewControllerRepresentable {
    let text: String
    let onDone: (Bool) -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [text], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, completed, _, _ in onDone(completed) }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// The context pack as it will leave the phone (PackPreview.tsx): the exact text, then copy it,
/// hand it to the system share sheet, or open an assistant in the system browser with it already
/// typed in. Every copy, share or link is confirmed first and recorded in the sharing log and the
/// chat history. Hearth sends nothing itself: the text goes where the user's own action takes it.
struct PackPreviewSection: View {
    let repo: Repo
    let pack: String
    let stats: PackStats
    let packed: [PackPerson]
    let question: String
    let realNames: Bool

    @Environment(\.openURL) private var openURL
    @State private var confirming: PackDestination?
    @State private var sharing = false
    @State private var notice: String?

    var body: some View {
        Section {
            ScrollView([.horizontal, .vertical]) {
                Text(pack)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(8)
            }
            .frame(maxHeight: 480)
            .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button(t("common.close"), role: .cancel) {}
            }
            Button(t("askPage.copyButton")) { confirming = .clipboard }
                .disabled(packed.isEmpty)
            Button(t("askPage.shareButton")) { confirming = .share }
                .disabled(packed.isEmpty)
            VStack(alignment: .leading, spacing: 8) {
                Text(t("askPage.openIn")).font(.subheadline.weight(.semibold))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Assistants.all) { a in
                            Button(a.name) { confirming = .assistant(a) }
                                .buttonStyle(.bordered)
                                .disabled(packed.isEmpty || Assistants.url(a, pack) == nil)
                        }
                    }
                }
            }
            if !packed.isEmpty && Assistants.all.contains(where: { Assistants.url($0, pack) == nil }) {
                Text(t("askPage.tooLong", ["chars": grouped(stats.chars)])).font(.footnote).foregroundStyle(.secondary)
            }
            Text(t("askPage.trainingNotice"))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .alert(t("askPage.confirmTitle"), isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } })) {
                    if let going = confirming {
                        Button(confirmLabel(going)) { send(going) }
                    }
                    Button(t("common.cancel"), role: .cancel) {}
                } message: {
                    Text(confirming.map(confirmMessage) ?? "")
                }
                .sheet(isPresented: $sharing) {
                    ActivityView(text: pack) { completed in
                        sharing = false
                        if completed { finish("share", t("askPage.shared")) }
                    }
                }
        } header: {
            Text(t("askPage.previewHeading", ["chars": grouped(stats.chars), "tokens": grouped(stats.tokens)]))
        }
    }

    private func confirmLabel(_ d: PackDestination) -> String {
        switch d {
        case .clipboard: return t("askPage.confirmCopy")
        case .share: return t("askPage.confirmShare")
        case .assistant(let a): return t("askPage.confirmOpen", ["assistant": a.name])
        }
    }

    /// An alert shows plain text: the body's markup is dropped, the counts and the log note follow
    /// as the web's list items.
    private func confirmMessage(_ d: PackDestination) -> String {
        let key: String
        var params: [String: CustomStringConvertible] = [:]
        switch d {
        case .clipboard: key = "askPage.confirmBody"
        case .share: key = "askPage.confirmShareBody"
        case .assistant(let a):
            key = "askPage.confirmLinkBody"
            params = ["assistant": a.name]
        }
        let body = String(rich(t(key, params)).characters)
        let counts = t("askPage.confirmCounts", [
            "genotypes": stats.genotypes,
            "healthEntries": stats.healthEntries,
            "people": packed.count,
            "peopleWord": packed.count == 1 ? t("askPage.person") : t("askPage.peopleWord"),
            "naming": realNames ? t("askPage.withRealNames") : t("askPage.pseudonymised"),
        ])
        return "\(body)\n\n• \(counts)\n• \(t("askPage.confirmLogged"))"
    }

    private func send(_ d: PackDestination) {
        switch d {
        case .clipboard:
            // On the clipboard for this device only and for ten minutes, so health data neither syncs
            // to the user's other devices through Universal Clipboard nor lingers there.
            UIPasteboard.general.setItems(
                [[UTType.utf8PlainText.identifier: pack]],
                options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(10 * 60)]
            )
            finish("clipboard", t("askPage.copied", ["destination": "clipboard"]))
        case .share:
            // After the confirmation alert has gone: one presentation cannot replace another in the same update.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { sharing = true }
        case .assistant(let a):
            guard let url = Assistants.url(a, pack) else { return }
            // The system browser opens it; the app opens no connection of its own.
            openURL(url)
            finish(a.id, t("askPage.opened", ["assistant": a.name]))
        }
    }

    /// Records the send in the sharing log and the chat history, then says so.
    private func finish(_ destination: String, _ message: String) {
        let text: String
        do {
            try repo.recordCopyOut(destination: destination, personIds: packed.map(\.person.id), question: question, pack: pack)
            text = message
        } catch {
            text = t("native.error", ["error": error.localizedDescription])
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { notice = text }
    }
}
