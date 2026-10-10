import SwiftUI

/// The empty state: nobody is here yet, so the one useful thing is to restore a backup. The system
/// file picker chooses the files (a backup, and with it the genome files of a folder backup), a
/// passphrase is asked for when one is sealed, and what the load did is handed to `onLoaded` (the
/// screen that shows it outlives this view, which disappears as soon as there are people).
struct RestoreBackupView: View {
    let repo: Repo
    let onLoaded: (String) -> Void

    @StateObject private var loader = FileLoader()
    @State private var picking = false
    @State private var working: String?

    var body: some View {
        ContentUnavailableView {
            Label(t("healthPage.title"), systemImage: "heart.text.square")
        } description: {
            Text(t("native.emptyBody"))
        } actions: {
            if let working {
                ProgressView(working)
            } else {
                Button(t("native.restoreBackup")) { picking = true }
                    .buttonStyle(.borderedProminent)
            }
        }
        // Any file: a .hearth file has no system type, and the header decides what it is.
        .fileImporter(isPresented: $picking, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
            loader.load(result, repo: repo, progress: { working = $0 }, done: onLoaded)
        }
        .asksLoadPassphrase(loader)
    }
}
