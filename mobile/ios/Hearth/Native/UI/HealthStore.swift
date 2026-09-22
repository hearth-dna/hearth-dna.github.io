import Foundation
import SwiftUI

/// What the native screens show, read from the database and re-read after every change. The log
/// is loaded whole, as the web's Health page loads it: a family's log is thousands of rows at
/// most, and filtering and sorting in memory keeps them exactly the web's.
///
/// Used from the main thread only, like the database under it.
final class HealthStore: ObservableObject {
    @Published private(set) var persons: [Person] = []
    @Published private(set) var entries: [HealthEntry] = []
    @Published private(set) var attachments: [String: [Attachment]] = [:]

    private let repo: Repo

    init(repo: Repo) throws {
        self.repo = repo
        try reload()
    }

    func reload() throws {
        persons = try repo.persons()
        entries = try repo.healthLog()
        attachments = try repo.attachments(entryIds: entries.map(\.id))
    }

    /// The display name for a person id; the id itself for a person who is not here (the web's
    /// fallback too).
    func personName(_ id: String) -> String {
        persons.first { $0.id == id }?.displayName ?? id
    }

    func add(_ entry: HealthEntry) throws {
        try repo.addHealthEntry(entry)
        try reload()
    }

    func delete(_ entry: HealthEntry) throws {
        try repo.deleteHealthEntry(id: entry.id)
        try reload()
    }

    func hasDocumentConsent(_ personId: String) throws -> Bool {
        try repo.hasConsent(.importDocument, subject: personId)
    }

    func grantDocumentConsent(_ personId: String) throws {
        try repo.grantConsent(.importDocument, subject: personId)
    }

    /// Opens and merges a backup. The file is opened on a background queue, because deriving the
    /// key of an encrypted one takes a noticeable moment by design; the merge itself runs back on
    /// the main thread, where the database lives.
    func restore(_ data: Data, passphrase: String?, completion: @escaping (Result<RestoreResult, Error>) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let opened = Result { try Container.open(data, passphrase: passphrase) }
            DispatchQueue.main.async {
                completion(opened.flatMap { dump in
                    Result { () throws -> RestoreResult in
                        let result = try Restore.run(dump, into: self.repo.db)
                        try self.reload()
                        return result
                    }
                })
            }
        }
    }
}

/// The native app's root (ADR 0010, staging step 1): its own database, which starts empty until a
/// backup is restored into it. Reached from a debug build only; see HearthApp.
struct NativeRootView: View {
    @StateObject private var database = NativeDatabase()
    @State private var consented = false

    var body: some View {
        switch database.opened {
        case .success(let opened):
            if consented || ((try? opened.repo.hasConsent(.firstLaunch)) ?? false) {
                HealthLogScreen(store: opened.store)
            } else {
                FirstLaunchView {
                    try opened.repo.grantConsent(.firstLaunch)
                    consented = true
                }
            }
        case .failure(let error):
            Text(t("app.startFailed", ["error": error.localizedDescription]))
                .multilineTextAlignment(.center)
                .padding(32)
        }
    }
}

/// Opens the database once for the life of the scene: a `@StateObject` is created once, where a
/// view's own properties are rebuilt on every update.
private final class NativeDatabase: ObservableObject {
    let opened: Result<(repo: Repo, store: HealthStore), Error> = Result {
        let repo = try Repo(db: Db.openDefault())
        return (repo, try HealthStore(repo: repo))
    }
}

/// The web's consent gate: every statement confirmed before anything is stored (design §13.1).
/// Statement 1 is about where data lives, which on a phone is not a browser, so it has its own text.
struct FirstLaunchView: View {
    let onAgree: () throws -> Void
    @State private var ticked = Array(repeating: false, count: ConsentKind.firstLaunch.statementKeys.count)
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(t("native.intro")).foregroundStyle(.secondary)
                }
                Section {
                    ForEach(ticked.indices, id: \.self) { i in
                        Toggle(isOn: $ticked[i]) { Text(t(key(i))) }
                    }
                } footer: {
                    Text(t("consentForm.recorded", ["version": ConsentKind.firstLaunch.version]))
                }
                Section {
                    Button(t("consentGate.start")) {
                        do { try onAgree() } catch { failure = t("native.error", ["error": error.localizedDescription]) }
                    }
                    .disabled(!ticked.allSatisfy { $0 })
                }
                if let failure {
                    Section { Text(failure).foregroundStyle(.red) }
                }
            }
            .navigationTitle(t("consent.first_launch.title"))
        }
    }

    private func key(_ i: Int) -> String {
        i == 0 ? "native.firstLaunchStorage" : ConsentKind.firstLaunch.statementKeys[i]
    }
}
