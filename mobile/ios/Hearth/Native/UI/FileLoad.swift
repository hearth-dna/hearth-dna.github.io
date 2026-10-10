import SwiftUI
import UniformTypeIdentifiers

/// What loading picked files says (BackupCard.tsx `useFileLoader`): what came in, whose DNA each
/// genome file was, what was not used or could not be opened, and who still waits for a genome file.
/// The web's wording that names a browser is the phone's own under `native.*`.
func loadMessage(_ r: LoadResult, waiting: [PersonRef]) -> String {
    var parts: [String] = []
    if r.dumps > 0 {
        parts.append(t("backupCard.loaded", ["people": r.people, "genomes": r.genomes, "exportedAt": r.exportedAt, "name": r.name]))
    } else {
        parts.append(t("backupCard.genomesLoaded", ["n": r.genomes]))
    }
    parts += r.dna.map { t("backupCard.dnaFrom", ["name": $0.name, "file": $0.file]) }
    if !r.missing.isEmpty { parts.append(t("restore.missingGenomes", ["names": r.missing.map(\.name).joined(separator: ", ")])) }
    if !waiting.isEmpty {
        parts.append(t("restore.genomesElsewhere", ["names": waiting.map(\.name).joined(separator: ", ")]) + " " + t("native.pickGenomes"))
    }
    if !r.unused.isEmpty { parts.append(t("native.notUsed", ["files": r.unused.joined(separator: ", ")])) }
    if !r.unopened.isEmpty { parts.append(t("backupCard.notOpened", ["files": r.unopened.joined(separator: ", ")])) }
    return parts.filter { !$0.isEmpty }.joined(separator: " ")
}

/// Why a load failed, in words for the screen.
func loadFailure(_ error: Error) -> String {
    let message: String
    switch error as? BackupError {
    case .notABackup?: message = t("native.notBackup")
    case .damaged?: message = t("native.damaged")
    case .wrongPassphrase?: message = t("app.wrongPassphrase")
    case .passphraseRequired?: message = t("native.encryptedTitle")
    case nil: message = error.localizedDescription
    }
    return t("backupCard.loadFailed", ["message": message])
}

private func isSealed(_ data: Data) -> Bool {
    Container.isEncrypted(data) || DumpV1.isSealed(data) || Sealer.isSealed(data)
}

/// "Restore a backup…" and "Load DNA files…": the system picker, several files at once (a folder
/// backup's snapshot and its genome files, or a zip of the whole folder), a passphrase when one is
/// sealed, then a merge into the database off the main thread. `passphrase` is tried first when the
/// caller already has one typed. `progress` gets the step in words, or nil when done; `done` gets
/// what the load says, whether it worked or not, and is where the caller reads its lists again.
private struct LoadsFiles: ViewModifier {
    @Binding var isPresented: Bool
    let repo: Repo
    let passphrase: String
    let progress: (String?) -> Void
    let done: (String) -> Void

    @State private var pending: [NamedFile]?
    @State private var typed = ""
    @State private var asking = false
    @State private var message = ""

    func body(content: Content) -> some View {
        content
            // Any file: a .hearth file has no system type, and the header decides what it is.
            .fileImporter(isPresented: $isPresented, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
                switch result {
                case .success(let urls): read(urls)
                case .failure(let error): done(loadFailure(error))
                }
            }
            .alert(t("app.passphrase"), isPresented: $asking) {
                SecureField(t("app.passphrase"), text: $typed)
                Button(t("common.cancel"), role: .cancel) {
                    pending = nil
                    typed = ""
                }
                Button(t("app.open")) {
                    if let files = pending { run(files, typed) }
                    pending = nil
                    typed = ""
                }
            } message: {
                Text(message)
            }
    }

    /// Reads the picked files (security-scoped URLs outside the app's sandbox) and either loads
    /// them or asks for a passphrase first.
    private func read(_ urls: [URL]) {
        var files: [NamedFile] = []
        for url in urls {
            do {
                files.append(NamedFile(name: url.lastPathComponent, data: try readPickedFile(url)))
            } catch {
                done(loadFailure(error))
                return
            }
        }
        if !files.contains(where: { isSealed($0.data) }) {
            run(files, "")
        } else if !passphrase.isEmpty {
            run(files, passphrase)
        } else {
            ask(files, t("native.encryptedTitle"))
        }
    }

    private func ask(_ files: [NamedFile], _ text: String) {
        pending = files
        typed = ""
        message = text
        asking = true
    }

    private func run(_ files: [NamedFile], _ pass: String) {
        progress(t("restore.openingDump"))
        let repo = self.repo
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { () throws -> (LoadResult, [PersonRef]) in
                let loaded = try Loader.load(repo, files, passphrase: pass) { key, params in
                    let step = t(key, params)
                    DispatchQueue.main.async { progress(step) }
                }
                return (loaded, Loader.waiting(repo))
            }
            DispatchQueue.main.async {
                progress(nil)
                switch result {
                case .success(let (loaded, waiting)):
                    done(loadMessage(loaded, waiting: waiting))
                case .failure(let error):
                    let backup = error as? BackupError
                    if backup == .wrongPassphrase || backup == .passphraseRequired {
                        // Ask again rather than send the user back through the file picker.
                        ask(files, t("app.wrongPassphrase"))
                    } else {
                        done(loadFailure(error))
                    }
                }
            }
        }
    }
}

extension View {
    func loadsFiles(
        isPresented: Binding<Bool>, repo: Repo, passphrase: String = "",
        progress: @escaping (String?) -> Void, done: @escaping (String) -> Void
    ) -> some View {
        modifier(LoadsFiles(isPresented: isPresented, repo: repo, passphrase: passphrase, progress: progress, done: done))
    }
}
