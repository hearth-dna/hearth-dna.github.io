import Foundation

/// Where backups go: a picked folder, iCloud Drive, a picked file, or a cloud drive the user signed
/// in to.
enum BackupPlace: Codable, Equatable {
    case folder(ref: String, name: String)
    case icloud(name: String)
    case file(ref: String, name: String)
    /// `folderId` nil means a `Hearth` folder in My Drive (Dropbox: its app folder).
    case cloud(provider: String, account: String, label: String, name: String, folderId: String?)

    var name: String {
        switch self {
        case .folder(_, let name), .icloud(let name), .file(_, let name): return name
        case .cloud(_, _, _, let name, _): return name
        }
    }

    var isFile: Bool {
        if case .file = self { return true }
        return false
    }

    var isCloud: Bool {
        if case .cloud = self { return true }
        return false
    }
}

/// The place and what this phone knows about it (folder.ts `Saved`).
struct SavedPlace: Codable, Equatable {
    var place: BackupPlace
    var lastSeen: Seen?
    /// The user chose to store without a passphrase.
    var plain = false
    var auto = true
    var lastAt: String?
    /// Attached documents the place held after the last copy.
    var mirrored = 0
}

/// What the Settings card and the sync button show (scheduler.ts `Status`).
enum BackupStatus: Equatable {
    case none
    case reconnect(String)
    case needsPassphrase(String)
    case ready(name: String, pending: Bool, dirty: Bool, lastAt: String?, attachmentsPending: Int, attachmentsMissing: Int)
    case writing(name: String, step: String)
    case error(name: String, message: String)
}

/// The phone's backup (backup/scheduler.ts): the remembered place, the passphrase kept in the
/// Keychain, a debounced backup after every change, and the one sync rule there is: **newer data
/// in the place is loaded first**, at start, whenever the app comes back to the foreground, and
/// before every backup. Loading is a union by id, so nothing is lost; a deletion does not travel.
///
/// Threads: the published status and the timer belong to the main thread; every read and write of
/// the place runs on one serial queue, which is also what keeps two backups from overlapping. The
/// remembered place is guarded by a lock, since both sides read it.
final class Backups: ObservableObject {
    static let appVersion = "native"
    /// Where the README tells a reader to restore from; a placeholder, the real one is the publisher's.
    static let appURL = "the Hearth app"
    /// The same Keychain item the web shell's `secretSet` used, so a passphrase kept there is found here.
    static let passphraseKey = "secret:hearth:default:backup-pass"
    private static let defaultsKey = "hearth.backup.default"
    private static let debounce: TimeInterval = 5

    @Published private(set) var status = BackupStatus.none
    /// Bumped after data from the place was loaded, so the screens reload.
    @Published private(set) var pulled = 0

    private let repo: Repo
    /// The sign-in the cloud places use; Settings starts a sign-in with it.
    let cloud: Cloud?
    private let queue = DispatchQueue(label: "hearth.backup", qos: .utility)
    private let lock = NSLock()
    private var stored: SavedPlace?
    private var timerPending = false
    private var cachedTokens: [String: String] = [:]
    /// Main thread only.
    private var timer: DispatchWorkItem?

    init(repo: Repo, cloud: Cloud?) {
        self.repo = repo
        self.cloud = cloud
        stored = Backups.load()
        repo.db.onChange = { [weak self] in
            DispatchQueue.main.async { self?.request() }
        }
        refreshSoon()
    }

    // MARK: - The remembered place

    var saved: SavedPlace? { locked { stored } }
    var plain: Bool { saved?.plain ?? false }
    var auto: Bool { saved?.auto ?? true }
    var single: Bool { saved?.place.isFile ?? false }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    private func update(_ change: (inout SavedPlace) -> Void) {
        locked {
            guard var s = stored else { return }
            change(&s)
            stored = s
        }
        store()
    }

    private func store() {
        let s = saved
        if let s, let data = try? JSONEncoder().encode(s) {
            UserDefaults.standard.set(data, forKey: Backups.defaultsKey)
        } else {
            UserDefaults.standard.removeObject(forKey: Backups.defaultsKey)
        }
        DispatchQueue.main.async { self.objectWillChange.send() }
    }

    private static func load() -> SavedPlace? {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey) else { return nil }
        return try? JSONDecoder().decode(SavedPlace.self, from: data)
    }

    func passphrase() -> String { Keychain.read(Backups.passphraseKey) ?? "" }

    func setPassphrase(_ p: String) {
        if p.isEmpty { Keychain.delete(Backups.passphraseKey) } else { Keychain.write(Backups.passphraseKey, p) }
        refreshSoon()
    }

    func setPlain(_ plain: Bool) {
        update { $0.plain = plain }
        refreshSoon()
    }

    func setAuto(_ auto: Bool) {
        update { $0.auto = auto }
        if auto { request() } else { cancelTimer() }
        refreshSoon()
    }

    /// A new place replaces the old one; its sign-in is released unless it is the same.
    func choose(_ place: BackupPlace) {
        if let old = saved?.place, old != place { release(old) }
        locked { stored = SavedPlace(place: place) }
        store()
        refreshSoon()
    }

    /// Forgets the place and, if asked, deletes the snapshots and copies in it. Answers (snapshots,
    /// files) on the main thread.
    func forget(deleteFiles: Bool, done: @escaping (Int, Int) -> Void) {
        queue.async {
            var snapshots = 0
            var files = 0
            if let s = self.saved, deleteFiles {
                let d = self.dir(s.place)
                snapshots = Backup.deleteSnapshots(d)
                files = Backup.removeDir(d, Backup.attachmentsDir)
                snapshots += Backup.removeDir(d, Backup.genomesDir)
            }
            if let place = self.saved?.place { self.release(place) }
            self.locked { self.stored = nil }
            self.store()
            Keychain.delete(Backups.passphraseKey)
            self.publish(.none)
            DispatchQueue.main.async { done(snapshots, files) }
        }
    }

    private func release(_ place: BackupPlace) {
        // A bookmark is only data: forgetting it is the whole release. A cloud grant is revoked.
        if case .cloud(let provider, let account, _, _, _) = place {
            DispatchQueue.main.async { self.cloud?.signOut(provider, account: account) { _, _ in } }
        }
    }

    private func dir(_ place: BackupPlace) -> BackupDir {
        switch place {
        case .folder(let ref, let name): return FolderDir(ref: ref, name: name)
        case .icloud(let name): return FolderDir(ref: nil, name: name)
        case .file(let ref, let name): return FileDir(ref: ref, name: name)
        case .cloud(let provider, let account, _, let name, let folderId):
            let token = tokens(provider, account)
            if provider == "google" { return GoogleDriveDir(token: token, name: name, folderId: folderId) }
            return DropboxDir(token: token, name: name)
        }
    }

    // MARK: - The schedule

    /// A change happened: with automatic sync on, a backup follows a quiet period (one per burst
    /// of writes). Main thread.
    func request() {
        guard let s = saved else { return }
        guard s.auto else {
            markReady(dirty: true, pending: nil)
            return
        }
        timer?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.timer = nil
            self.locked { self.timerPending = false }
            self.backupNow()
        }
        timer = work
        locked { timerPending = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + Backups.debounce, execute: work)
        markReady(dirty: true, pending: true)
    }

    private func cancelTimer() {
        let cancel = {
            self.timer?.cancel()
            self.timer = nil
            self.locked { self.timerPending = false }
        }
        if Thread.isMainThread { cancel() } else { DispatchQueue.main.async(execute: cancel) }
    }

    private func markReady(dirty: Bool, pending: Bool?) {
        if case .ready(let name, let p, _, let lastAt, let a, let m) = status {
            status = .ready(name: name, pending: pending ?? p, dirty: dirty, lastAt: lastAt, attachmentsPending: a, attachmentsMissing: m)
        }
    }

    private func publish(_ s: BackupStatus) {
        DispatchQueue.main.async { self.status = s }
    }

    /// Back in the foreground, or asked by a screen: re-read the place and pull anything newer.
    func refreshSoon() {
        queue.async { self.refresh() }
    }

    /// Brings in whatever the place has that this phone has not seen, then writes this phone's
    /// state back.
    func sync() {
        cancelTimer()
        queue.async {
            if self.pullIfNewer() == .failed { return }
            self.backup()
        }
    }

    /// Writes a snapshot now, after loading anything newer the place holds.
    func backupNow(done: (() -> Void)? = nil) {
        cancelTimer()
        queue.async {
            self.backup()
            if let done { DispatchQueue.main.async(execute: done) }
        }
    }

    /// Loads the place's snapshot now (union by id); for "Load from folder".
    func loadFromPlace(done: @escaping (Result<RestoreResult, Error>) -> Void) {
        queue.async {
            let result = Result { () throws -> RestoreResult in
                guard let s = self.saved else { throw DbError(message: "no backup place chosen") }
                return try self.pull(self.dir(s.place))
            }
            self.refresh()
            DispatchQueue.main.async { done(result) }
        }
    }

    /// Fetches documents this phone has rows for but not bytes.
    func pullDocuments(done: @escaping (Result<(pulled: Int, missing: Int), Error>) -> Void) {
        queue.async {
            let result = Result { () throws -> (pulled: Int, missing: Int) in
                guard let s = self.saved else { return (0, 0) }
                return try Backup.pullAttachments(self.dir(s.place), self.repo, passphrase: self.key())
            }
            self.refresh()
            DispatchQueue.main.async { done(result) }
        }
    }

    // MARK: - The work, on the queue

    private func device() -> String { ((try? repo.getMeta("device")) ?? nil) ?? "" }
    private func generation() -> Int64 { Int64(((try? repo.getMeta("generation")) ?? nil) ?? "0") ?? 0 }

    /// The passphrase to encrypt with, or nil when storing plain or none is set.
    private func key() -> String? {
        let pass = passphrase()
        return plain || pass.isEmpty ? nil : pass
    }

    private func isDirty() -> Bool {
        guard let seen = saved?.lastSeen else { return true }
        return seen.device != device() || generation() > seen.generation
    }

    private func granted(_ place: BackupPlace) -> Bool {
        switch place {
        case .folder(let ref, _), .file(let ref, _): return PlaceAccess.granted(ref)
        case .icloud: return NativeFiles.iCloudRoot() != nil
        case .cloud(let provider, let account, _, _, _):
            do {
                _ = try tokens(provider, account)(false)
                return true
            } catch is SignInNeeded {
                return false
            } catch {
                return true
            }
        }
    }

    private func message(_ error: Error) -> String {
        switch error as? BackupError {
        case .notABackup?: return "native.notBackup"
        case .damaged?: return "native.damaged"
        case .wrongPassphrase?: return "app.wrongPassphrase"
        case .passphraseRequired?: return "native.encryptedTitle"
        case nil: return error.localizedDescription
        }
    }

    /// Re-derives the status from the place, and loads a newer snapshot when there is one.
    private func refresh() {
        guard let s = saved else { return publish(.none) }
        let name = s.place.name
        guard granted(s.place) else { return publish(.reconnect(name)) }
        let current: DumpHeader?
        do {
            current = try Backup.currentHeader(dir(s.place))
        } catch {
            return publish(.error(name: name, message: message(error)))
        }
        // Follow the place: with no passphrase here and an unencrypted backup there, keep writing
        // it unencrypted rather than stop syncing.
        if let current, current.encrypted != true, passphrase().isEmpty, !s.plain { update { $0.plain = true } }
        let newer = Backup.hasNewer(current, ourDevice: device(), lastSeen: saved?.lastSeen)
        if newer && current?.encrypted == true && passphrase().isEmpty { return publish(.needsPassphrase(name)) }
        if newer {
            if pullIfNewer() != .failed { backup() }
            return
        }
        if !plain && passphrase().isEmpty { return publish(.needsPassphrase(name)) }
        let dirty = isDirty()
        let documents = (try? repo.db.query("SELECT DISTINCT sha256 FROM attachment").map { $0.text("sha256") }) ?? []
        let have = Set(repo.blobs.list())
        let missing = documents.filter { !have.contains(Repo.attachmentBlobName($0)) }.count
        let pending = locked { timerPending }
        publish(.ready(
            name: name, pending: pending, dirty: dirty, lastAt: saved?.lastAt,
            attachmentsPending: single ? 0 : max(0, documents.count - (saved?.mirrored ?? 0)), attachmentsMissing: missing
        ))
        // Changes made while the place was unreachable go out without waiting for the next edit.
        if dirty && auto && !pending { DispatchQueue.main.async { self.request() } }
    }

    private enum PullOutcome { case pulled, current, failed }

    private func pullIfNewer() -> PullOutcome {
        guard let s = saved else { return .current }
        do {
            let d = dir(s.place)
            guard Backup.hasNewer(try Backup.currentHeader(d), ourDevice: device(), lastSeen: s.lastSeen) else { return .current }
            publish(.writing(name: s.place.name, step: "loading"))
            _ = try pull(d)
            return .pulled
        } catch {
            publish(.error(name: s.place.name, message: message(error)))
            return .failed
        }
    }

    private func backup() {
        guard let s = saved else { return }
        let name = s.place.name
        guard granted(s.place) else { return publish(.reconnect(name)) }
        if pullIfNewer() == .failed { return }
        let pass = passphrase()
        if !plain && pass.isEmpty { return publish(.needsPassphrase(name)) }
        // Nothing of ours the place lacks (a pull just brought it level): no write, no new rotation.
        if saved?.lastSeen != nil && !isDirty() { return refresh() }
        publish(.writing(name: name, step: "building"))
        do {
            let d = dir(s.place)
            let key = plain ? nil : pass
            let bytes: Data
            if d.single {
                bytes = try SnapshotWriter.bytes(repo, appVersion: Backups.appVersion, passphrase: key)
            } else {
                // Genomes beside the snapshot, written once; after an edit only the journal goes.
                let snap = try SnapshotWriter.build(repo, appVersion: Backups.appVersion, embed: false)
                publish(.writing(name: name, step: "writing"))
                try Backup.mirrorGenomes(d, repo, snap.files, passphrase: key)
                bytes = try SnapshotWriter.serialise(snap, passphrase: key)
            }
            publish(.writing(name: name, step: "writing"))
            try Backup.writeSnapshot(d, bytes, appURL: Backups.appURL)
            let seen = Seen(device: device(), generation: generation())
            update {
                $0.lastSeen = seen
                $0.lastAt = nowISO()
            }
            publish(.writing(name: name, step: "attachments"))
            // Not fatal: the snapshot is written, and a refused file must not cost the user it.
            if !d.single, let n = try? Backup.mirrorAttachments(d, repo, passphrase: key) { update { $0.mirrored = n } }
        } catch {
            return publish(.error(name: name, message: message(error)))
        }
        refresh()
    }

    /// Loads the place's snapshot. Folder genomes are fetched before the restore starts, so no
    /// network wait happens while the database is held.
    private func pull(_ d: BackupDir) throws -> RestoreResult {
        guard let bytes = try d.read(Backup.snapshot) else { throw DbError(message: "no \(Backup.snapshot) in \(d.name)") }
        let pass = passphrase().isEmpty ? nil : passphrase()
        let result: RestoreResult
        var header = Backup.readHeaderPrefix(bytes)
        if DumpV1.isV1(bytes) {
            result = try DumpV1.restore(DumpV1.open(bytes, passphrase: pass), into: repo)
        } else {
            let dump = try Container.open(bytes, passphrase: pass)
            header = header ?? dump.header
            let had = try Set(repo.db.query("SELECT DISTINCT person_id FROM genotype").map { $0.text("person_id") })
            let loader = Backup.genomeLoader(d, passphrase: pass)
            var fetched: [String: Data] = [:]
            for g in dump.genomes where dump.genomeFiles[g.path] == nil && !had.contains(g.personId) {
                if let data = try loader(g) { fetched[g.path] = data }
            }
            let ready = fetched
            result = try Restore.run(dump, into: repo, loadGenome: { ready[$0.path] })
        }
        _ = try? Backup.pullAttachments(d, repo, passphrase: pass)
        if let header, let device = header.device {
            let seen = Seen(device: device, generation: header.generation ?? 0)
            update { $0.lastSeen = seen }
        }
        DispatchQueue.main.async { self.pulled += 1 }
        return result
    }

    // MARK: - Tokens, from Cloud.swift's callbacks

    /// Access tokens for a cloud place, asked of Cloud on the main thread and awaited here.
    private func tokens(_ provider: String, _ account: String) -> TokenSource {
        { [weak self] fresh in
            guard let self else { throw SignInNeeded(provider: provider) }
            let key = "\(provider):\(account)"
            let have = self.locked { self.cachedTokens[key] }
            if !fresh, let have { return have }
            guard let cloud = self.cloud else { throw SignInNeeded(provider: provider) }
            let done = DispatchSemaphore(value: 0)
            var answer: Any?
            var failure: String?
            DispatchQueue.main.async {
                cloud.token(provider, account: account, stale: fresh ? have : nil) { value, error in
                    answer = value
                    failure = error
                    done.signal()
                }
            }
            if done.wait(timeout: .now() + 60) == .timedOut {
                throw DbError(message: "signing in to \(provider) took too long")
            }
            if let failure { throw DbError(message: failure) }
            guard let token = answer as? String else { throw SignInNeeded(provider: provider) }
            self.locked { self.cachedTokens[key] = token }
            return token
        }
    }
}
