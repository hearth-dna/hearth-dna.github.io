import Foundation
import SwiftUI

/// What the native screens show, read from the database and re-read after every change. The log
/// is loaded whole, as the web's Health page loads it: a family's log is thousands of rows at
/// most, and filtering and sorting in memory keeps them exactly the web's.
///
/// Used from the main thread only; the one slow operation, a restore, runs its work off it.
final class HealthStore: ObservableObject {
    @Published private(set) var persons: [Person] = []
    @Published private(set) var entries: [HealthEntry] = []
    @Published private(set) var attachments: [String: [Attachment]] = [:]

    let repo: Repo

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

    @discardableResult
    func add(_ entry: HealthEntry) throws -> HealthEntry {
        let saved = try repo.addHealthEntry(entry)
        try reload()
        return saved
    }

    /// Keeps the files with a saved entry, each on its own: a file that cannot be kept is reported
    /// (one message each), never lost silently, and the entry stays saved either way.
    func attach(_ files: [PickedFile], to entry: HealthEntry) -> [String] {
        var failures: [String] = []
        let already = attachments[entry.id]?.count ?? 0
        for (i, f) in files.enumerated() {
            do {
                try Attachments.add(
                    repo, healthLogId: entry.id, personId: entry.personId, data: f.data, name: f.name, already: already + i
                )
            } catch {
                failures.append(Attachments.message(error, name: f.name))
            }
        }
        try? reload()
        return failures
    }

    /// The row, then the file when no other entry holds the same document.
    func removeAttachment(_ a: Attachment) throws {
        try repo.deleteAttachment(id: a.id)
        try reload()
    }

    /// Whether the file behind an attachment is on this phone, without reading it.
    func hasAttachmentData(_ a: Attachment) -> Bool {
        repo.blobs.list().contains(Repo.attachmentBlobName(a.sha256))
    }

    /// The bytes behind an attachment, or nil when only its metadata is on this phone.
    func attachmentData(_ a: Attachment) -> Data? {
        Attachments.bytes(repo, a)
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

    /// Opens and merges a backup on a background queue: deriving the key of an encrypted file
    /// takes a noticeable moment by design, and loading its genomes takes seconds. `Db` serialises
    /// access, and the screen shows only a progress indicator meanwhile. The completion and the
    /// reload run back on the main thread.
    func restore(_ data: Data, passphrase: String?, completion: @escaping (Result<RestoreResult, Error>) -> Void) {
        let repo = self.repo
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { () throws -> RestoreResult in
                try Restore.run(Container.open(data, passphrase: passphrase), into: repo)
            }
            DispatchQueue.main.async {
                completion(result.flatMap { restored in
                    Result { () throws -> RestoreResult in
                        try self.reload()
                        return restored
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
    /// Bumped when the language changes, so every screen is built again in it.
    @State private var language = Strings.shared.language
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch database.opened {
            case .success(let opened):
                if consented || ((try? opened.repo.hasConsent(.firstLaunch)) ?? false) {
                    NativeTabs(
                        health: opened.health, people: opened.people, backups: opened.backups,
                        onLanguage: { code in
                            Strings.choose(code)
                            language = Strings.shared.language
                        },
                        onErased: {
                            // Erased, or the first-launch consent withdrawn: back behind the gate.
                            consented = false
                            try? opened.health.reload()
                            try? opened.people.reload()
                        }
                    )
                    .onChange(of: scenePhase) { _, phase in
                        // Back in the foreground: another device may have written to the backup meanwhile.
                        if phase == .active { opened.backups.refreshSoon() }
                    }
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
        .id(language)
        .environment(\.layoutDirection, Strings.shared.rightToLeft ? .rightToLeft : .leftToRight)
        .environment(\.locale, Locale(identifier: language))
    }
}

/// Opens the database once for the life of the scene: a `@StateObject` is created once, where a
/// view's own properties are rebuilt on every update.
private final class NativeDatabase: ObservableObject {
    let opened: Result<(repo: Repo, health: HealthStore, people: PeopleStore, backups: Backups), Error> = Result {
        let repo = try Repo(db: Db.openDefault(), blobs: Blobs.openDefault())
        return (repo, try HealthStore(repo: repo), PeopleStore(repo: repo), Backups(repo: repo, cloud: Cloud()))
    }
}

/// The web's top-level pages as a tab bar, in TabBar.tsx's order (People, Lookup, Health, Ask,
/// Settings), each tab with its own navigation stack. Health is where the app opens, as on
/// Android. A person's report is pushed on People; its health-log row switches to Health scoped to
/// that person.
private struct NativeTabs: View {
    @ObservedObject var health: HealthStore
    @ObservedObject var people: PeopleStore
    @ObservedObject var backups: Backups
    let onLanguage: (String) -> Void
    let onErased: () -> Void

    private enum Tab: Hashable {
        case people, family, health, ask, settings
    }

    @State private var tab = Tab.health
    @State private var healthScope: String?

    var body: some View {
        TabView(selection: $tab) {
            PeopleScreen(store: people, kb: Kb.bundled, backups: backups) { personId in
                healthScope = personId
                tab = .health
            }
            .tabItem { Label(t("app.navPeople"), systemImage: "person.2") }
            .tag(Tab.people)
            FamilyScreen(repo: people.repo, kb: Kb.bundled)
                .tabItem { Label(t("app.tabFamily"), systemImage: "magnifyingglass") }
                .tag(Tab.family)
            HealthLogScreen(store: health, backups: backups, scopeRequest: $healthScope)
                .tabItem { Label(t("app.navHealth"), systemImage: "heart.text.square") }
                .tag(Tab.health)
            AskScreen(repo: people.repo, kb: Kb.bundled)
                .tabItem { Label(t("app.navAsk"), systemImage: "bubble.left.and.bubble.right") }
                .tag(Tab.ask)
            SettingsScreen(repo: people.repo, kb: Kb.bundled, backups: backups, onLanguage: onLanguage, onErased: onErased)
                .tabItem { Label(t("app.tabSettings"), systemImage: "gearshape") }
                .tag(Tab.settings)
        }
        // Data loaded from the backup place: the lists read again.
        .onChange(of: backups.pulled) {
            try? health.reload()
            try? people.reload()
        }
    }
}

/// The web's consent gate: every statement confirmed before anything is stored (design §13.1).
/// Statement 1 is about where data lives, which on a phone is not a browser, so it has its own text.
struct FirstLaunchView: View {
    let onAgree: () throws -> Void
    @State private var ticked = ConsentChecks.unticked(.firstLaunch)
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(t("native.intro")).foregroundStyle(.secondary)
                }
                ConsentChecks(kind: .firstLaunch, ticked: $ticked, statementKey: key)
                Section {
                    Button(t("consentGate.start")) {
                        do { try onAgree() } catch { failure = t("native.error", ["error": error.localizedDescription]) }
                    }
                    .disabled(!ConsentChecks.allTicked(ticked, .firstLaunch))
                }
                if let failure {
                    Section { Text(failure).foregroundStyle(.red) }
                }
            }
            .navigationTitle(t("consent.first_launch.title"))
        }
    }

    /// Statement 1 is about where data lives, which on a phone is not a browser.
    private func key(_ i: Int, _ key: String) -> String {
        i == 0 ? "native.firstLaunchStorage" : key
    }
}
