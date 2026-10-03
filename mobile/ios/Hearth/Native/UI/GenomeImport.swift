import SwiftUI
import UniformTypeIdentifiers

// The imports run on a background queue with the same `Db` as the screens: `Db` serialises every
// call, and each sheet stays up (it cannot be swiped away) until its import has finished, so
// nothing else reaches the database meanwhile. Progress and the result come back on the main queue.

private func progressText(_ p: ImportProgress) -> String {
    t(p.key, p.params.mapValues { value -> CustomStringConvertible in
        if let n = value as? Int { return grouped(n) }
        return value
    })
}

private func summaryText(_ s: ImportSummary) -> String {
    t("importFile.summary", [
        "n": grouped(s.calls), "provider": s.provider.label, "build": s.build, "skipped": grouped(s.skipped),
    ]) + "."
}

private func failureText(_ error: Error) -> String {
    if error is NoCallsError { return t("importFile.noRows") }
    return t("native.error", ["error": error.localizedDescription])
}

/// Auto-detect, then every provider by its label (the web's provider select).
private struct ProviderPicker: View {
    let labelKey: String
    let autoKey: String
    @Binding var value: Provider?

    var body: some View {
        Picker(t(labelKey), selection: $value) {
            Text(t(autoKey)).tag(Provider?.none)
            ForEach(Provider.allCases) { provider in
                Text(provider.label).tag(Provider?.some(provider))
            }
        }
    }
}

/// One DNA file for one person (ImportDialog.tsx): the genome consent the first time, with the
/// guardian's statement and `import_minor` for someone under 18, then the provider and the file,
/// then progress while it is unpacked, parsed and stored on this phone.
struct ImportSheet: View {
    let repo: Repo
    let person: Person

    private enum Stage: Equatable {
        case consent
        case pick
        case working(String, Double)
        case done(String)
        case failed(String)
    }

    @Environment(\.dismiss) private var dismiss
    @State private var stage: Stage?
    @State private var forced: Provider?
    @State private var guardian = false
    @State private var ticked = ConsentChecks.unticked(.importGenome)
    @State private var picking = false

    private var minor: Bool {
        guard let born = person.birthYear else { return false }
        return Calendar.current.component(.year, from: Date()) - born < 18
    }

    private var busy: Bool {
        if case .working? = stage { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            Form {
                switch stage {
                case nil:
                    EmptyView()
                case .consent?:
                    consent
                case .pick?:
                    Section {
                        Text(t("native.importAccepted")).foregroundStyle(.secondary)
                        ProviderPicker(labelKey: "importDialog.provider", autoKey: "importDialog.autoDetect", value: $forced)
                    }
                    Section {
                        Button(t("native.chooseFile")) { picking = true }
                    }
                case .working(let message, let pct)?:
                    Section {
                        Text(message)
                        ProgressView(value: pct, total: 100)
                    }
                case .done(let message)?:
                    Section {
                        Text(message).foregroundStyle(.tint)
                        Button(t("common.close")) { dismiss() }
                    }
                case .failed(let message)?:
                    Section {
                        Text(message).foregroundStyle(.red)
                        Button(t("importDialog.tryAgain")) { stage = .pick }
                    }
                }
            }
            .navigationTitle(t("importDialog.title", ["name": person.displayName]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.close")) { dismiss() }
                        .disabled(busy)
                }
            }
        }
        // Parsing a genome takes seconds; the sheet stays until it is finished.
        .interactiveDismissDisabled(busy)
        .fileImporter(isPresented: $picking, allowedContentTypes: [.data]) { result in
            switch result {
            case .success(let url): run(url)
            case .failure(let error): stage = .failed(failureText(error))
            }
        }
        .onAppear(perform: start)
    }

    @ViewBuilder
    private var consent: some View {
        if minor {
            Section {
                Toggle(isOn: $guardian) { Text(t("importDialog.guardianStatement")) }
            } header: {
                Text(t("importDialog.under18"))
            }
        }
        ConsentChecks(kind: .importGenome, ticked: $ticked, header: t(ConsentKind.importGenome.titleKey))
        Section {
            Button(t("consentForm.confirm")) { grant() }
                .disabled(!((guardian || !minor) && ConsentChecks.allTicked(ticked, .importGenome)))
        }
    }

    private func start() {
        guard stage == nil else { return }
        do {
            stage = try repo.hasConsent(.importGenome, subject: person.id) ? .pick : .consent
        } catch {
            stage = .failed(failureText(error))
        }
    }

    private func grant() {
        do {
            try repo.grantConsent(.importGenome, subject: person.id)
            if minor { try repo.grantConsent(.importMinor, subject: person.id) }
            stage = .pick
        } catch {
            stage = .failed(failureText(error))
        }
    }

    private func run(_ url: URL) {
        stage = .working(t("importFile.unpacking"), 0)
        let repo = self.repo
        let personId = person.id
        let forced = self.forced
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { () throws -> ImportSummary in
                try GenomeImport.importFile(
                    repo: repo, personId: personId, data: readPickedFile(url), fileName: url.lastPathComponent,
                    forced: forced
                ) { p in
                    let message = progressText(p)
                    DispatchQueue.main.async { stage = .working(message, p.pct) }
                }
            }
            DispatchQueue.main.async {
                switch result {
                case .success(let summary): stage = .done(summaryText(summary))
                case .failure(let error): stage = .failed(failureText(error))
                }
            }
        }
    }
}

/// Several DNA files at once (BatchImportDialog.tsx): one new person per file, named after it, one
/// genome consent for the batch recorded for each person created. No one here can be a minor: the
/// birth year is unknown until the user sets it.
struct BatchImportSheet: View {
    let repo: Repo

    private struct FileRow: Identifiable {
        enum Status {
            case queued, working, done, error
        }

        let id = UUID()
        let url: URL
        let name: String
        var status = Status.queued
        var message = ""
        var pct = 0.0
    }

    private enum Stage {
        case pick, consent, running, done
    }

    @Environment(\.dismiss) private var dismiss
    @State private var rows: [FileRow] = []
    @State private var forced: Provider?
    @State private var stage = Stage.pick
    @State private var ticked = ConsentChecks.unticked(.importGenome)
    @State private var picking = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                switch stage {
                case .pick:
                    pick
                case .consent:
                    Section {
                        Text(t("batchImportDialog.consentNote")).foregroundStyle(.secondary)
                    }
                    ConsentChecks(kind: .importGenome, ticked: $ticked, header: t(ConsentKind.importGenome.titleKey))
                    Section {
                        Button(t("consentForm.confirm")) { run() }
                            .disabled(!ConsentChecks.allTicked(ticked, .importGenome))
                    }
                case .running, .done:
                    progress
                }
            }
            .navigationTitle(t("batchImportDialog.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(stage == .running ? t("batchImportDialog.importing") : t("common.close")) { dismiss() }
                        .disabled(stage == .running)
                }
            }
        }
        .interactiveDismissDisabled(stage == .running)
        .fileImporter(isPresented: $picking, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): rows = urls.map { FileRow(url: $0, name: $0.lastPathComponent) }
            case .failure(let error): failure = failureText(error)
            }
        }
    }

    @ViewBuilder
    private var pick: some View {
        Section {
            Text(t("batchImportDialog.intro")).foregroundStyle(.secondary)
            ProviderPicker(labelKey: "batchImportDialog.provider", autoKey: "batchImportDialog.autoDetectPerFile", value: $forced)
            Button(t("native.chooseFiles")) { picking = true }
        }
        if !rows.isEmpty {
            Section {
                ForEach(rows) { row in
                    Text(rich(t("batchImportDialog.fileToPerson", [
                        "file": row.name, "name": GenomeImport.personFromFileName(row.name).displayName,
                    ])))
                }
            }
        }
        if let failure {
            Section { Text(failure).foregroundStyle(.red) }
        }
        Section {
            Button(t("batchImportDialog.continue")) { stage = .consent }
                .disabled(rows.isEmpty)
        }
    }

    private var progress: some View {
        Section {
            ForEach(rows) { row in
                VStack(alignment: .leading, spacing: 4) {
                    Text(GenomeImport.personFromFileName(row.name).displayName).font(.headline)
                    Text(row.status == .queued ? t("batchImportDialog.queued") : row.message)
                        .font(.subheadline)
                        .foregroundStyle(color(row.status))
                    if row.status == .working {
                        ProgressView(value: row.pct, total: 100)
                    }
                }
            }
        }
    }

    private func color(_ status: FileRow.Status) -> Color {
        switch status {
        case .error: return .red
        case .done: return .accentColor
        case .queued, .working: return .secondary
        }
    }

    /// One file after another, each in its own person; a failure marks its row and moves on.
    private func run() {
        stage = .running
        let repo = self.repo
        let forced = self.forced
        let files = rows.map { (id: $0.id, url: $0.url, name: $0.name) }
        DispatchQueue.global(qos: .userInitiated).async {
            for file in files {
                DispatchQueue.main.async {
                    update(file.id) { row in
                        row.status = .working
                        row.message = t("batchImportDialog.creatingPerson")
                    }
                }
                let result = Result { () throws -> ImportSummary in
                    let (label, name) = GenomeImport.personFromFileName(file.name)
                    let person = try repo.addPerson(label: label, displayName: name, sex: .unknown, birthYear: nil)
                    try repo.grantConsent(.importGenome, subject: person.id)
                    return try GenomeImport.importFile(
                        repo: repo, personId: person.id, data: readPickedFile(file.url), fileName: file.name,
                        forced: forced
                    ) { p in
                        let message = progressText(p)
                        DispatchQueue.main.async {
                            update(file.id) { row in
                                row.message = message
                                row.pct = p.pct
                            }
                        }
                    }
                }
                DispatchQueue.main.async {
                    update(file.id) { row in
                        switch result {
                        case .success(let summary):
                            row.status = .done
                            row.message = summaryText(summary)
                            row.pct = 100
                        case .failure(let error):
                            row.status = .error
                            row.message = failureText(error)
                        }
                    }
                }
            }
            DispatchQueue.main.async { stage = .done }
        }
    }

    private func update(_ id: UUID, _ change: (inout FileRow) -> Void) {
        guard let i = rows.firstIndex(where: { $0.id == id }) else { return }
        change(&rows[i])
    }
}
