import SwiftUI
import UniformTypeIdentifiers

/// Bytes handed to the system's save sheet; the file never passes through anything else.
struct DataDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    var data: Data

    init(data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

private func mb(_ bytes: Int) -> String {
    String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), Double(bytes) / 1024 / 1024)
}

/// "2026-09-21T10:00:00.000Z" as the phone's local time of day.
func clockTime(_ iso: String) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = parser.date(from: iso) else { return iso }
    return date.formatted(date: .omitted, time: .shortened)
}

/// Runs `work` on a background queue and hands its result back on the main one.
private func background<T>(_ work: @escaping () throws -> T, done: @escaping (Result<T, Error>) -> Void) {
    DispatchQueue.global(qos: .userInitiated).async {
        let result = Result { try work() }
        DispatchQueue.main.async { done(result) }
    }
}

private func describe(_ error: Error) -> String {
    switch error as? BackupError {
    case .notABackup?: return t("native.notBackup")
    case .damaged?: return t("native.damaged")
    case .wrongPassphrase?: return t("app.wrongPassphrase")
    case .passphraseRequired?: return t("native.encryptedTitle")
    case nil: return error.localizedDescription
    }
}

/// Settings & export (SettingsPage.tsx): language, the full dump, the backup place, open formats,
/// the Gemini key, consents with revoke, the sharing log, and erasing everything. The file
/// pickers and the save sheet live here, one of each, and each card asks for them with a purpose.
struct SettingsScreen: View {
    let repo: Repo
    let kb: Kb
    @ObservedObject var backups: Backups
    let onLanguage: (String) -> Void
    let onErased: () -> Void

    private enum Importing {
        case dump, folder, file
    }

    private enum Exporting {
        case dump(encrypted: Bool)
        case newBackupFile
        case openFormat(rows: Int)
    }

    @State private var notice: String?
    @State private var busy: String?
    @State private var dumpPass = ""
    @State private var importing: Importing?
    @State private var exporting: Exporting?
    @State private var document = DataDocument(data: Data())
    @State private var exportName = ""

    // Backup card
    @State private var consenting: String?
    @State private var ticks: [Bool] = []
    @State private var changing = false
    @State private var forgetting = false
    @State private var drive: DriveChoice?
    @State private var backupPass = ""
    @State private var iCloudAvailable = false

    // Open formats
    @State private var format = OpenFormat.csv
    @State private var sharedOnly = true

    // Gemini
    @State private var keyStored = Keychain.read(GeminiSecrets.key) != nil
    @State private var newKey = ""
    @State private var model = Keychain.read(GeminiSecrets.model) ?? Egress.geminiDefaultModel

    // Consents, sharing, erase
    @State private var consents: [Repo.ConsentRecord] = []
    @State private var names: [String: String] = [:]
    @State private var revoking: Repo.ConsentRecord?
    @State private var sharing: [Repo.Shared] = []
    @State private var openShared: Int?
    @State private var erasing = false

    var body: some View {
        NavigationStack {
            Form {
                languageSection
                dumpSection
                backupSection
                openFormatsSection
                geminiSection
                consentsSection
                sharingSection
                eraseSection
            }
            .navigationTitle(t("settingsPage.title"))
            .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button(t("common.close"), role: .cancel) {}
            }
            .fileImporter(
                isPresented: Binding(get: { importing != nil }, set: { if !$0 { importing = nil } }),
                allowedContentTypes: importing == .folder ? [.folder] : [.data]
            ) { result in imported(result) }
            .fileExporter(
                isPresented: Binding(get: { exporting != nil }, set: { if !$0 { exporting = nil } }),
                document: document, contentType: .data, defaultFilename: exportName
            ) { result in exported(result) }
            .sheet(item: $drive) { choice in
                DriveFolderSheet(folders: choice.folders) { picked in
                    drive = nil
                    guard let picked else { return }
                    let label = choice.label.isEmpty ? choice.account : choice.label
                    let name = picked.path.isEmpty ? "\(t("backupCard.google")) (\(label))" : "\(t("backupCard.google")) › \(picked.path)"
                    backups.choose(.cloud(provider: "google", account: choice.account, label: label, name: name, folderId: picked.id))
                    changing = false
                }
            }
            .sheet(isPresented: $erasing) {
                EraseSheet(repo: repo) {
                    erasing = false
                    onErased()
                }
            }
            .confirmationDialog(t("backupCard.forgetConfirm"), isPresented: $forgetting, titleVisibility: .visible) {
                Button(capitalisedFirst(t("common.delete")), role: .destructive) { forget(deleteFiles: true) }
                Button(t("native.keepFiles")) { forget(deleteFiles: false) }
                Button(t("common.cancel"), role: .cancel) {}
            }
            .confirmationDialog(
                revoking.map { revokeQuestion($0) } ?? "",
                isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }),
                titleVisibility: .visible,
                presenting: revoking
            ) { c in
                Button(capitalisedFirst(t("settingsPage.revoke")), role: .destructive) { revoke(c) }
                Button(t("common.cancel"), role: .cancel) {}
            }
        }
        .onAppear(perform: reload)
    }

    private func say(_ message: String) {
        // After any sheet or picker has gone: one presentation cannot replace another mid-update.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { notice = message }
    }

    private func reload() {
        consents = (try? repo.listConsents()) ?? []
        names = Dictionary(((try? repo.persons()) ?? []).map { ($0.id, $0.displayName) }, uniquingKeysWith: { a, _ in a })
        sharing = (try? repo.listSharing()) ?? []
        backupPass = backups.passphrase()
        DispatchQueue.global(qos: .utility).async {
            let available = NativeFiles.iCloudRoot() != nil
            DispatchQueue.main.async { iCloudAvailable = available }
        }
    }

    // MARK: - Language

    private var languageSection: some View {
        Section {
            Picker(t("common.language"), selection: Binding(get: { Strings.shared.language }, set: onLanguage)) {
                ForEach(Strings.languages) { l in Text(l.name).tag(l.code) }
            }
        } header: {
            Text(t("common.language"))
        } footer: {
            Text(t("settingsPage.languageNote"))
        }
    }

    // MARK: - Full dump

    private var dumpSection: some View {
        Section {
            Text(t("native.fullDumpIntro")).font(.subheadline).foregroundStyle(.secondary)
            SecureField(t("settingsPage.passphrase"), text: $dumpPass)
            Button(t("settingsPage.exportDump")) { exportDump() }.disabled(busy != nil)
            Button(t("settingsPage.importDump")) { importing = .dump }.disabled(busy != nil)
            if let busy {
                HStack {
                    Text(busy).foregroundStyle(.secondary)
                    Spacer()
                    ProgressView()
                }
            }
        } header: {
            Text(t("settingsPage.fullDump"))
        }
    }

    private func exportDump() {
        busy = t("settingsPage.buildingDump")
        let pass = dumpPass.isEmpty ? nil : dumpPass
        let repo = self.repo
        background({ try SnapshotWriter.bytes(repo, appVersion: Backups.appVersion, passphrase: pass) }) { result in
            busy = nil
            switch result {
            case .success(let data):
                document = DataDocument(data: data)
                exportName = "hearth-\(HealthLog.localDate()).hearth"
                exporting = .dump(encrypted: pass != nil)
            case .failure(let error):
                say(t("eraseDialog.exportFailed", ["error": describe(error)]))
            }
        }
    }

    private func importDump(_ url: URL) {
        busy = t("settingsPage.readingDump")
        let pass = dumpPass.isEmpty ? nil : dumpPass
        let repo = self.repo
        background({
            try Restore.bytes(readPickedFile(url), passphrase: pass, into: repo) { key, params in
                let message = t(key, params)
                DispatchQueue.main.async { busy = message }
            }
        }) { result in
            busy = nil
            switch result {
            case .success(let r):
                say(t("settingsPage.imported", ["people": r.persons, "genomes": r.genomes, "version": 2, "exportedAt": r.exportedAt]))
                reload()
            case .failure(let error):
                say(t("settingsPage.importFailed", ["error": describe(error)]))
            }
        }
    }

    private func imported(_ result: Result<URL, Error>) {
        let purpose = importing
        importing = nil
        guard case .success(let url) = result else { return }
        switch purpose {
        case .dump?:
            importDump(url)
        case .folder?, .file?:
            do {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let ref = try PlaceAccess.bookmark(url)
                backups.choose(purpose == .folder ? .folder(ref: ref, name: url.lastPathComponent) : .file(ref: ref, name: url.lastPathComponent))
                changing = false
            } catch {
                say(t("native.providerRefuses"))
            }
        case nil:
            break
        }
    }

    private func exported(_ result: Result<URL, Error>) {
        let purpose = exporting
        exporting = nil
        switch result {
        case .failure(let error):
            say(t("eraseDialog.exportFailed", ["error": error.localizedDescription]))
        case .success(let url):
            switch purpose {
            case .dump(let encrypted)?:
                say(t(encrypted ? "exportDump.encrypted" : "exportDump.plaintext", ["name": url.lastPathComponent, "mb": mb(document.data.count)]))
            case .openFormat(let rows)?:
                say(t("native.saved", ["name": url.lastPathComponent, "rows": grouped(rows), "mb": mb(document.data.count)]))
            case .newBackupFile?:
                do {
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    backups.choose(.file(ref: try PlaceAccess.bookmark(url), name: url.lastPathComponent))
                    changing = false
                } catch {
                    say(t("native.providerRefuses"))
                }
            case nil:
                break
            }
        }
        document = DataDocument(data: Data())
    }

    // MARK: - Backup

    private var providers: [String] {
        ["google", "dropbox"].filter { Cloud.provider($0) != nil }
    }

    private func label(_ mode: String) -> String {
        switch mode {
        case "icloud": return t("backupCard.icloud")
        case "google": return t("backupCard.google")
        case "dropbox": return t("backupCard.dropbox")
        case "folder": return t("backupCard.chooseFolder")
        case "newFile": return t("backupCard.newFile")
        default: return t("backupCard.existingFile")
        }
    }

    private func consentKind(_ mode: String) -> ConsentKind {
        mode == "google" || mode == "dropbox" ? .cloudBackup : .backupFolder
    }

    private func choose(_ mode: String) {
        let kind = consentKind(mode)
        guard (try? repo.hasConsent(kind)) == true else {
            ticks = ConsentChecks.unticked(kind)
            consenting = mode
            return
        }
        switch mode {
        case "icloud":
            backups.choose(.icloud(name: t("backupCard.icloud")))
            changing = false
        case "google", "dropbox":
            signIn(mode)
        case "folder":
            importing = .folder
        case "newFile":
            document = DataDocument(data: Data())
            exportName = Backup.snapshot
            exporting = .newBackupFile
        default:
            importing = .file
        }
    }

    private func signIn(_ provider: String) {
        guard let cloud = backups.cloud else { return }
        cloud.signIn(provider) { value, error in
            if let error { return say(error) }
            guard let signed = value as? [String: Any], let token = signed["token"] as? String else { return }
            let account = signed["account"] as? String ?? ""
            let label = signed["label"] as? String ?? account
            if provider == "dropbox" {
                backups.choose(.cloud(provider: "dropbox", account: account, label: label, name: "\(t("backupCard.dropbox")) (\(label))", folderId: nil))
                changing = false
            } else {
                drive = DriveChoice(account: account, label: label, folders: DriveFolders(token: { _ in token }))
            }
        }
    }

    private func forget(deleteFiles: Bool) {
        backups.forget(deleteFiles: deleteFiles) { snapshots, files in
            try? repo.revokeConsent(kind: ConsentKind.backupFolder.rawValue, subject: "")
            say(deleteFiles
                ? t("backupCard.forgottenDeletedWithFiles", ["n": snapshots, "files": files])
                : t("backupCard.forgottenKept"))
            reload()
        }
    }

    @ViewBuilder
    private var pickButtons: some View {
        if !providers.isEmpty {
            Text(t("backupCard.cloudHint")).font(.subheadline).foregroundStyle(.secondary)
            ForEach(providers, id: \.self) { p in
                Button(label(p)) { choose(p) }
            }
        }
        Text(rich(t(providers.isEmpty ? "backupCard.pickHint" : "backupCard.otherPlacesHint")))
            .font(.subheadline)
            .foregroundStyle(.secondary)
        if iCloudAvailable {
            Button(label("icloud")) { choose("icloud") }
        }
        ForEach(["folder", "newFile", "existingFile"], id: \.self) { m in
            Button(label(m)) { choose(m) }
        }
        if changing {
            Button(t("common.cancel"), role: .cancel) { changing = false }
        }
    }

    private var activity: String? {
        if case .writing(let name, let step) = backups.status {
            let key: String
            switch step {
            case "loading": key = "backupCard.loading"
            case "building": key = "backupCard.building"
            case "attachments": key = "backupCard.copyingAttachments"
            default: key = "backupCard.writingFile"
            }
            return t(key, ["name": name])
        }
        return busy
    }

    @ViewBuilder
    private var backupSection: some View {
        Section {
            Text(t(providers.isEmpty ? "backupCard.introPhone" : "backupCard.introCloud"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let mode = consenting {
                let kind = consentKind(mode)
                Text(t(kind.titleKey)).font(.headline)
                ForEach(Array(kind.statementKeys.enumerated()), id: \.offset) { i, key in
                    Toggle(t(key), isOn: Binding(
                        get: { i < ticks.count && ticks[i] },
                        set: { on in if i < ticks.count { ticks[i] = on } }
                    ))
                }
                Button(label(mode)) {
                    try? repo.grantConsent(kind)
                    consenting = nil
                    choose(mode)
                }
                .disabled(!ConsentChecks.allTicked(ticks, kind))
                Button(t("common.cancel"), role: .cancel) { consenting = nil }
            } else if backups.status == .none {
                pickButtons
            } else {
                placeRows
            }
        } header: {
            Text(t("backupCard.title"))
        }
    }

    @ViewBuilder
    private var placeRows: some View {
        let status = backups.status
        let name = backups.saved?.place.name ?? ""
        Text(rich(t(backups.single ? "backupCard.file" : "backupCard.folder", ["name": name])))
        if case .ready(_, let pending, _, let lastAt, let attachmentsPending, let missing) = status {
            let bits = [
                lastAt.map { t("backupCard.lastBackup", ["time": clockTime($0)]) } ?? "",
                pending ? t("backupCard.pending") : "",
                attachmentsPending > 0 ? t("backupCard.attachmentsPending", ["n": attachmentsPending]) : "",
            ].joined()
            if !bits.isEmpty {
                Text(bits.hasPrefix(" · ") ? String(bits.dropFirst(3)) : bits).font(.subheadline).foregroundStyle(.secondary)
            }
            if missing > 0 && !backups.single {
                Text(t("backupCard.attachmentsMissing", ["n": missing]))
                Button(t("backupCard.fetchAttachments")) {
                    backups.pullDocuments { result in
                        switch result {
                        case .success(let r): say(t("backupCard.attachmentsFetched", ["n": r.pulled, "missing": r.missing]))
                        case .failure(let error): say(t("backupCard.failed", ["message": describe(error)]))
                        }
                    }
                }
            }
        }
        if backups.single { Text(t("backupCard.singleNote")).font(.footnote).foregroundStyle(.secondary) }
        if backups.saved?.place.isCloud == true { Text(t("backupCard.cloudNote")).font(.footnote).foregroundStyle(.secondary) }
        if let activity {
            HStack {
                Text(activity).foregroundStyle(.secondary)
                Spacer()
                ProgressView()
            }
        }
        // Applied on submit, never per keystroke: half a passphrase must not encrypt a backup.
        SecureField(t(backups.plain ? "backupCard.passphraseNotUsed" : "backupCard.passphraseRequired"), text: $backupPass)
            .disabled(backups.plain)
            .onSubmit { if backupPass != backups.passphrase() { backups.setPassphrase(backupPass) } }
        if !backups.plain { Text(t("backupCard.passphraseKept")).font(.footnote).foregroundStyle(.secondary) }
        Toggle(t("backupCard.autoSync"), isOn: Binding(get: { backups.auto }, set: { backups.setAuto($0) }))
        Toggle(t("backupCard.storeUnencrypted"), isOn: Binding(get: { backups.plain }, set: { backups.setPlain($0) }))
        switch status {
        case .reconnect(let place):
            Text(t("backupCard.reconnectNoticeNative", ["name": place]))
            Button(t("backupCard.pickAgain")) { changing = true }
        case .needsPassphrase:
            Text(t("backupCard.needsPassphrase"))
        case .error(_, let message):
            Text(t("backupCard.failed", ["message": t(message)])).foregroundStyle(.red)
        default:
            EmptyView()
        }
        let working = activity != nil
        Button(t("backupCard.backUpNow")) { backUpNow() }
            .disabled(working || !(isReady || isError))
        if isReady {
            Button(t("backupCard.loadFromFolder")) { loadFromPlace(name) }.disabled(working)
        }
        Button(t("backupCard.changeFolder")) { changing = true }.disabled(working)
        Button(t("backupCard.forgetFolder"), role: .destructive) { forgetting = true }.disabled(working)
        if changing { pickButtons }
    }

    private var isReady: Bool {
        if case .ready = backups.status { return true }
        return false
    }

    private var isError: Bool {
        if case .error = backups.status { return true }
        return false
    }

    private func backUpNow() {
        if backupPass != backups.passphrase() { backups.setPassphrase(backupPass) }
        backups.backupNow {
            if case .ready(let name, _, _, let lastAt, _, _) = backups.status {
                say(t("backupCard.done", ["name": name, "time": lastAt.map(clockTime) ?? ""]))
            }
        }
    }

    private func loadFromPlace(_ name: String) {
        busy = t("backupCard.loading", ["name": name])
        backups.loadFromPlace { result in
            busy = nil
            switch result {
            case .success(let r):
                say(t("backupCard.loaded", ["people": r.persons, "genomes": r.genomes, "name": name, "exportedAt": r.exportedAt]))
                reload()
            case .failure(let error):
                say(t("backupCard.failed", ["message": describe(error)]))
            }
        }
    }

    // MARK: - Open formats

    private var openFormatsSection: some View {
        Section {
            Text(t("openFormats.intro")).font(.subheadline).foregroundStyle(.secondary)
            Picker(t("openFormats.title"), selection: $format) {
                ForEach(OpenFormat.allCases) { f in Text(t("openFormats.\(f.rawValue)")).tag(f) }
            }
            .pickerStyle(.segmented)
            Toggle(t("openFormats.sharedOnly"), isOn: $sharedOnly)
            Button(t("openFormats.genotypes")) { exportTable("genotypes") }.disabled(busy != nil)
            Button(t("openFormats.findings")) { exportTable("findings") }.disabled(busy != nil)
            Button(t("openFormats.healthLog")) { exportTable("health-log") }.disabled(busy != nil)
            Text(t("openFormats.plaintextWarning")).font(.footnote).foregroundStyle(.secondary)
        } header: {
            Text(t("openFormats.title"))
        }
    }

    private func exportTable(_ what: String) {
        busy = t("openFormats.building", ["what": t("openFormats.\(what == "health-log" ? "healthLog" : what)")])
        let repo = self.repo
        let kb = self.kb
        let format = self.format
        let shared = sharedOnly
        background({ () throws -> (Data, Int) in
            let persons = try repo.persons()
            let table: Table
            switch what {
            case "genotypes":
                table = try OpenFormats.genotypeTable(repo.db, OpenFormats.personColumns(persons), shared: shared)
            case "findings":
                let rsids = kb.entries.map(\.rsid)
                let byPerson = try persons.map { p -> (person: Person, findings: [Finding]) in
                    (person: p, findings: KbLogic.computeFindings(kb, try repo.personCallsFor(personId: p.id, rsids: rsids)))
                }
                table = OpenFormats.findingsTable(byPerson)
            default:
                let log = try repo.healthLog()
                let counts = try repo.attachments(entryIds: log.map(\.id)).mapValues(\.count)
                let byPerson = persons.map { p -> (person: Person, entries: [HealthEntry]) in
                    (person: p, entries: log.filter { $0.personId == p.id })
                }
                table = OpenFormats.healthTable(byPerson, attachmentCounts: counts)
            }
            return (Data(OpenFormats.render(table, format).utf8), table.rows.count)
        }) { result in
            busy = nil
            switch result {
            case .success(let (data, rows)):
                document = DataDocument(data: data)
                exportName = OpenFormats.fileName(what, format)
                exporting = .openFormat(rows: rows)
            case .failure(let error):
                say(t("openFormats.failed", ["error": error.localizedDescription]))
            }
        }
    }

    // MARK: - Gemini key

    private var geminiSection: some View {
        Section {
            Text(t("native.documentReadingIntro")).font(.subheadline).foregroundStyle(.secondary)
            Text(t("settingsPage.freeTierNotice")).font(.footnote)
            if !keyStored { GeminiKeySteps() }
            SecureField(t("settingsPage.apiKey") + (keyStored ? " " + t("settingsPage.stored") : ""), text: $newKey)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField(t("settingsPage.model"), text: $model)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button(t("common.save")) {
                let key = newKey.trimmingCharacters(in: .whitespacesAndNewlines)
                if !key.isEmpty { Keychain.write(GeminiSecrets.key, key) }
                let m = model.trimmingCharacters(in: .whitespacesAndNewlines)
                if m.isEmpty || m == Egress.geminiDefaultModel { Keychain.delete(GeminiSecrets.model) } else { Keychain.write(GeminiSecrets.model, m) }
                newKey = ""
                keyStored = Keychain.read(GeminiSecrets.key) != nil
                say(t("settingsPage.geminiSaved"))
            }
            .disabled(newKey.trimmingCharacters(in: .whitespaces).isEmpty && !keyStored)
            if keyStored {
                Button(t("settingsPage.removeKey"), role: .destructive) {
                    Keychain.delete(GeminiSecrets.key)
                    keyStored = false
                    say(t("settingsPage.geminiRemoved"))
                }
            }
        } header: {
            Text(t("settingsPage.documentReading"))
        }
    }

    // MARK: - Consents, sharing log, erase

    private var consentsSection: some View {
        Section {
            if consents.isEmpty { Text(t("settingsPage.noneRecorded")).foregroundStyle(.secondary) }
            ForEach(consents) { c in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: "\(ConsentKind(rawValue: c.kind).map { t($0.titleKey) } ?? c.kind) v\(c.version)")
                        Text(verbatim: "\(names[c.subject] ?? (c.subject.isEmpty ? "—" : c.subject)) · \(c.grantedAt.prefix(16).replacingOccurrences(of: "T", with: " "))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(capitalisedFirst(t("settingsPage.revoke")), role: .destructive) {
                        if ["import_document", "import_genome", "import_minor"].contains(c.kind) { revoking = c } else { revoke(c) }
                    }
                    .buttonStyle(.borderless)
                }
            }
        } header: {
            Text(t("settingsPage.consents"))
        }
    }

    private func revokeQuestion(_ c: Repo.ConsentRecord) -> String {
        t("settingsPage.revokeConfirm", [
            "who": names[c.subject] ?? c.subject,
            "what": t(c.kind == "import_document" ? "settingsPage.healthLog" : "settingsPage.genome"),
        ])
    }

    private func revoke(_ c: Repo.ConsentRecord) {
        do {
            try repo.revokeConsent(kind: c.kind, subject: c.subject)
            if c.kind == ConsentKind.readDocumentByok.rawValue { Keychain.delete(GeminiSecrets.key) }
            // Withdrawing the first-launch consent puts the app back behind the gate.
            if c.kind == ConsentKind.firstLaunch.rawValue { return onErased() }
            reload()
        } catch {
            say(t("native.error", ["error": error.localizedDescription]))
        }
    }

    private var sharingSection: some View {
        Section {
            Text(t("settingsPage.sharingLogIntro")).font(.subheadline).foregroundStyle(.secondary)
            if sharing.isEmpty { Text(t("common.empty")).foregroundStyle(.secondary) }
            ForEach(sharing) { s in
                Button {
                    openShared = openShared == s.id ? nil : s.id
                } label: {
                    Text(t("settingsPage.sharingSummary", [
                        "date": s.createdAt.prefix(16).replacingOccurrences(of: "T", with: " "),
                        "kind": s.kind, "destination": s.destination, "chars": s.payload.utf16.count,
                    ]))
                }
                if openShared == s.id {
                    Text(s.payload).font(.caption.monospaced()).textSelection(.enabled)
                }
            }
        } header: {
            Text(t("settingsPage.sharingLog"))
        }
    }

    private var eraseSection: some View {
        Section {
            Text(t("native.eraseIntro")).font(.subheadline).foregroundStyle(.secondary)
            Button(t("settingsPage.eraseAllData"), role: .destructive) { erasing = true }
        } header: {
            Text(t("settingsPage.eraseEverything"))
        }
    }
}

/// Who signed in to Google, waiting for the folder to back up into.
struct DriveChoice: Identifiable {
    let id = UUID()
    let account: String
    let label: String
    let folders: DriveFolders
}

/// Where on Drive the backup goes (DriveFolderChooser.tsx): a folder that already holds one (the
/// backup from another device is one tap away), a folder found by name, or a `Hearth` folder in My
/// Drive. Answers (id, path), (nil, "") for the default, or nil when the user backs out.
private struct DriveFolderSheet: View {
    let folders: DriveFolders
    let onDone: ((id: String?, path: String)?) -> Void

    @State private var withBackup: [DriveFolder]?
    @State private var query = ""
    @State private var found: [DriveFolder] = []
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let withBackup {
                        ForEach(withBackup) { f in Button(f.name) { pick(f) } }
                    } else {
                        ProgressView()
                    }
                } header: {
                    Text(t("driveFolder.withBackup"))
                }
                Section {
                    TextField(t("driveFolder.search"), text: $query)
                        .onSubmit(search)
                        .submitLabel(.search)
                    ForEach(found) { f in Button(f.name) { pick(f) } }
                }
                if let failure {
                    Section { Text(failure).foregroundStyle(.red) }
                }
                Section {
                    Button(t("native.driveDefault")) { onDone((nil, "")) }
                }
            }
            .navigationTitle(t("driveFolder.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { onDone(nil) }
                }
            }
        }
        .onAppear {
            let folders = self.folders
            background({ try folders.withBackup() }) { result in
                switch result {
                case .success(let list): withBackup = list
                case .failure(let error):
                    withBackup = []
                    failure = error.localizedDescription
                }
            }
        }
    }

    private func search() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let folders = self.folders
        background({ try folders.search(text) }) { result in
            switch result {
            case .success(let list): found = list
            case .failure(let error): failure = error.localizedDescription
            }
        }
    }

    private func pick(_ f: DriveFolder) {
        let folders = self.folders
        background({ folders.path(f.id) }) { result in
            onDone((f.id, (try? result.get()) ?? f.name))
        }
    }
}

/// Erasing everything (EraseDialog.tsx): export first if wanted, then erase and go back to the
/// first-launch gate.
private struct EraseSheet: View {
    let repo: Repo
    let onErased: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var pass = ""
    @State private var message: String?
    @State private var exporting = false
    @State private var document = DataDocument(data: Data())
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(t("native.eraseIntro"))
                    Text(rich(t("eraseDialog.exportFirst")))
                    SecureField(t("eraseDialog.passphrase"), text: $pass)
                    Button(t("eraseDialog.exportDump")) { export() }
                    if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
                    Text(t("eraseDialog.attachmentsNotice")).font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    Button(t("eraseDialog.eraseEverything"), role: .destructive) {
                        do {
                            try repo.eraseEverything()
                            onErased()
                        } catch {
                            failure = error.localizedDescription
                        }
                    }
                }
                if let failure {
                    Section { Text(failure).foregroundStyle(.red) }
                }
            }
            .navigationTitle(t("eraseDialog.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { dismiss() }
                }
            }
            .fileExporter(
                isPresented: $exporting, document: document, contentType: .data,
                defaultFilename: "hearth-\(HealthLog.localDate()).hearth"
            ) { result in
                switch result {
                case .success(let url):
                    message = t(pass.isEmpty ? "exportDump.plaintext" : "exportDump.encrypted", ["name": url.lastPathComponent, "mb": mb(document.data.count)])
                case .failure(let error):
                    message = t("eraseDialog.exportFailed", ["error": error.localizedDescription])
                }
            }
        }
    }

    private func export() {
        let repo = self.repo
        let passphrase = pass.isEmpty ? nil : pass
        background({ try SnapshotWriter.bytes(repo, appVersion: Backups.appVersion, passphrase: passphrase) }) { result in
            switch result {
            case .success(let data):
                document = DataDocument(data: data)
                exporting = true
            case .failure(let error):
                message = t("eraseDialog.exportFailed", ["error": describe(error)])
            }
        }
    }
}

/// The header's sync state (SyncButton.tsx): tap to sync now; it says why it cannot when it cannot.
struct SyncButton: View {
    @ObservedObject var backups: Backups

    var body: some View {
        if let s = state {
            Button { backups.sync() } label: {
                Text(s.label).font(.subheadline.weight(.semibold)).foregroundStyle(s.color)
            }
        }
    }

    private var state: (label: String, color: Color)? {
        switch backups.status {
        case .none: return nil
        case .reconnect: return (t("sync.reconnect"), .red)
        case .needsPassphrase: return (t("sync.passphrase"), .red)
        case .writing: return (t("sync.syncing"), .secondary)
        case .error: return (t("sync.error"), .red)
        case .ready(_, let pending, let dirty, let lastAt, _, _):
            if pending { return (t("sync.pending"), .secondary) }
            if dirty { return (t("sync.unsynced"), severityColor(4)) }
            if let lastAt { return (t("sync.syncedAt", ["time": clockTime(lastAt)]), .accentColor) }
            return (t("sync.synced"), .accentColor)
        }
    }
}
