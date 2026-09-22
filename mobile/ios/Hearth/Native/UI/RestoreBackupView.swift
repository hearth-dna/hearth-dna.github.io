import SwiftUI
import UniformTypeIdentifiers

/// The empty state: nobody is here yet, so the one useful thing is to restore a backup. The system
/// file picker chooses the file, a passphrase is asked for when it is encrypted, and the merge
/// reports back through `onRestored` (the screen that shows the result outlives this view, which
/// disappears as soon as there are people).
struct RestoreBackupView: View {
    @ObservedObject var store: HealthStore
    let onRestored: (RestoreResult) -> Void

    @State private var picking = false
    @State private var working = false
    /// An encrypted file waiting for its passphrase.
    @State private var pending: Data?
    @State private var passphrase = ""
    @State private var passphraseMessage = ""
    @State private var askingPassphrase = false
    @State private var failure: String?

    var body: some View {
        ContentUnavailableView {
            Label(t("healthPage.title"), systemImage: "heart.text.square")
        } description: {
            Text(t("native.emptyBody"))
        } actions: {
            if working {
                ProgressView(t("restore.openingDump"))
            } else {
                Button(t("native.restoreBackup")) { picking = true }
                    .buttonStyle(.borderedProminent)
            }
        }
        // Any file: a .hearth file has no system type, and the header decides what it is.
        .fileImporter(isPresented: $picking, allowedContentTypes: [.data]) { result in
            switch result {
            case .success(let url): readFile(url)
            case .failure(let error): failure = t("settingsPage.importFailed", ["error": error.localizedDescription])
            }
        }
        .alert(t("app.passphrase"), isPresented: $askingPassphrase) {
            SecureField(t("app.passphrase"), text: $passphrase)
            Button(t("common.cancel"), role: .cancel) {
                pending = nil
                passphrase = ""
            }
            Button(t("app.open")) {
                if let data = pending { restore(data, passphrase: passphrase) }
                pending = nil
                passphrase = ""
            }
        } message: {
            Text(passphraseMessage)
        }
        .alert(failure ?? "", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button(t("common.close"), role: .cancel) {}
        }
    }

    /// Reads the picked file (a security-scoped URL outside the app's sandbox) and either restores
    /// it or asks for its passphrase first.
    private func readFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            failure = t("settingsPage.importFailed", ["error": error.localizedDescription])
            return
        }
        if Container.isEncrypted(data) {
            askForPassphrase(data, message: t("native.encryptedTitle"))
        } else {
            restore(data, passphrase: nil)
        }
    }

    private func askForPassphrase(_ data: Data, message: String) {
        pending = data
        passphrase = ""
        passphraseMessage = message
        askingPassphrase = true
    }

    private func restore(_ data: Data, passphrase: String?) {
        working = true
        store.restore(data, passphrase: passphrase) { result in
            working = false
            switch result {
            case .success(let restored):
                onRestored(restored)
            case .failure(let error):
                let backupError = error as? BackupError
                if backupError == .wrongPassphrase || backupError == .passphraseRequired {
                    // Ask again rather than send the user back through the file picker.
                    askForPassphrase(data, message: t("app.wrongPassphrase"))
                } else {
                    failure = RestoreBackupView.message(for: error)
                }
            }
        }
    }

    /// Plain words for what went wrong. Nothing was changed in any of these cases: the file is
    /// opened completely before the merge starts, and the merge is one transaction.
    private static func message(for error: Error) -> String {
        switch error as? BackupError {
        case .notABackup?: return t("native.notBackup")
        case .damaged?: return t("native.damaged")
        case .passphraseRequired?, .wrongPassphrase?: return t("app.wrongPassphrase")
        case nil: return t("settingsPage.importFailed", ["error": error.localizedDescription])
        }
    }
}
