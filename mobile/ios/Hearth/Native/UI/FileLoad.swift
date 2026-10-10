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

/// "Restore a backup…" and "Load DNA files…": several files picked at once (a folder backup's
/// snapshot and its genome files, or a zip of the whole folder), a passphrase asked for when one is
/// sealed, then a merge into the database off the main thread. The owner keeps one of these, hangs
/// `.asksLoadPassphrase(loader)` on a view, and feeds it the result of its own file importer, so a
/// screen keeps the single importer SwiftUI is happy with.
final class FileLoader: ObservableObject {
    @Published var asking = false
    @Published var typed = ""
    @Published private(set) var message = ""

    private var pending: [NamedFile]?
    private var repo: Repo?
    private var progress: (String?) -> Void = { _ in }
    private var done: (String) -> Void = { _ in }

    /// `passphrase` is tried first when the caller already has one typed. `progress` gets the step
    /// in words, or nil when done; `done` gets what the load says, whether it worked or not, and is
    /// where the caller reads its lists again.
    func load(
        _ result: Result<[URL], Error>, repo: Repo, passphrase: String = "",
        progress: @escaping (String?) -> Void, done: @escaping (String) -> Void
    ) {
        self.repo = repo
        self.progress = progress
        self.done = done
        let urls: [URL]
        switch result {
        case .success(let picked): urls = picked
        case .failure(let error): return done(loadFailure(error))
        }
        var files: [NamedFile] = []
        for url in urls {
            do {
                files.append(NamedFile(name: url.lastPathComponent, data: try readPickedFile(url)))
            } catch {
                return done(loadFailure(error))
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

    func submitPassphrase() {
        let files = pending
        let pass = typed
        pending = nil
        typed = ""
        if let files { run(files, pass) }
    }

    func cancelPassphrase() {
        pending = nil
        typed = ""
    }

    private func ask(_ files: [NamedFile], _ text: String) {
        pending = files
        typed = ""
        message = text
        asking = true
    }

    private func run(_ files: [NamedFile], _ pass: String) {
        guard let repo else { return }
        progress(t("restore.openingDump"))
        let progress = self.progress
        let done = self.done
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
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
                        self?.ask(files, t("app.wrongPassphrase"))
                    } else {
                        done(loadFailure(error))
                    }
                }
            }
        }
    }
}

private struct AsksLoadPassphrase: ViewModifier {
    @ObservedObject var loader: FileLoader

    func body(content: Content) -> some View {
        content.alert(t("app.passphrase"), isPresented: $loader.asking) {
            SecureField(t("app.passphrase"), text: $loader.typed)
            Button(t("common.cancel"), role: .cancel) { loader.cancelPassphrase() }
            Button(t("app.open")) { loader.submitPassphrase() }
        } message: {
            Text(loader.message)
        }
    }
}

extension View {
    func asksLoadPassphrase(_ loader: FileLoader) -> some View {
        modifier(AsksLoadPassphrase(loader: loader))
    }
}
