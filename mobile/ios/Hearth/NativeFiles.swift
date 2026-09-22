import Foundation
import UIKit
import UniformTypeIdentifiers
import WebKit

/// The backup place on iOS: the system document picker, and file calls on what it returned
/// (docs/decisions/0008-cloud-backups-on-the-phones.md; the page's half is
/// `frontend/src/backup/native.ts`).
///
/// The Files picker lists iCloud Drive, On My iPhone and every installed provider — Google Drive,
/// Dropbox, OneDrive — and each provider's own app does the syncing. So this is file I/O on the
/// device, with no network code and no account in the shell. What the user picks is kept as a
/// security-scoped bookmark: a grant to that one folder or file, useless outside this app.
///
/// A folder holds the snapshot, its rotations and the attached documents, as the desktop backup
/// folder does. A single file is there for providers that will not lend a folder; it holds only
/// the snapshot. Every read and write goes through `NSFileCoordinator`, which is what makes iCloud
/// download an evicted file before it is read and upload it after it is written.
final class NativeFiles: NSObject, WKScriptMessageHandlerWithReply, UIDocumentPickerDelegate {
    /// The handler name the page sees: `window.webkit.messageHandlers.hearthFiles`.
    static let name = "hearthFiles"
    /// Kept in step with `CHUNK_BYTES` in native.ts.
    static let chunkBytes = 1 << 20
    /// The ref of Hearth's own folder in iCloud Drive (`ICLOUD` in native.ts). No bookmark: the
    /// app's ubiquity container is always its own to open.
    static let icloud = "icloud"

    /// Google Drive and Dropbox sign-in (Cloud.swift), over this same channel.
    let cloud = Cloud()

    typealias Reply = (Any?, String?) -> Void

    /// Every file call, in order, off the main thread: a provider can take seconds to fetch a file.
    private let queue = DispatchQueue(label: "hearth.files", qos: .userInitiated)
    // Touched only on `queue`.
    private var reads: [String: (data: Data, offset: Int)] = [:]
    private var writes: [String: (ref: String, path: [String], name: String?, data: Data)] = [:]
    private var nextHandle = 0

    /// The one picker that may be open, and who to answer when it closes. Main thread only.
    private var picking: (reply: Reply, single: Bool)?

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping Reply
    ) {
        // Only the app's own page, never a frame inside it. Nothing else is ever loaded in this
        // web view (links go to Safari), but the check costs nothing.
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.host == "127.0.0.1",
              origin.port == Int(LocalWebServer.port.rawValue),
              let body = message.body as? [String: Any],
              let op = body["op"] as? String
        else {
            replyHandler(nil, "refused")
            return
        }
        switch op {
        case "pick":
            pick(body, reply: replyHandler)
            return
        case "cloudProviders":
            // Resolving the ubiquity container can take a moment the first time; off the main thread.
            queue.async {
                let clouds = (Self.iCloudRoot() == nil ? [] : ["icloud"])
                    + ["google", "dropbox"].filter { Cloud.provider($0) != nil }
                DispatchQueue.main.async { replyHandler(clouds, nil) }
            }
            return
        case "cloudSignIn":
            cloud.signIn(body["provider"] as? String ?? "", reply: replyHandler)
            return
        case "cloudToken":
            cloud.token(
                body["provider"] as? String ?? "",
                account: body["account"] as? String ?? "",
                stale: body["stale"] as? String,
                reply: replyHandler
            )
            return
        case "cloudSignOut":
            cloud.signOut(body["provider"] as? String ?? "", account: body["account"] as? String ?? "", reply: replyHandler)
            return
        default:
            break
        }
        queue.async {
            let result = Result { try self.run(op, body) }
            DispatchQueue.main.async {
                switch result {
                case .success(let value): replyHandler(value, nil)
                case .failure(let error): replyHandler(nil, error.localizedDescription)
                }
            }
        }
    }

    // MARK: - Picking

    private func pick(_ body: [String: Any], reply: @escaping Reply) {
        guard picking == nil else {
            reply(nil, "a picker is already open")
            return
        }
        let mode = body["mode"] as? String ?? ""
        let picker: UIDocumentPickerViewController
        switch mode {
        case "icloud":
            // Hearth's own folder in iCloud Drive: nothing to pick, it only has to exist.
            queue.async {
                let available = Self.iCloudRoot() != nil
                DispatchQueue.main.async {
                    if available {
                        let location: [String: Any] = ["ref": Self.icloud, "name": "iCloud Drive", "single": false]
                        reply(location, nil)
                    } else {
                        reply(nil, "iCloud Drive is off on this device (Settings → your name → iCloud)")
                    }
                }
            }
            return
        case "folder":
            picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
        case "existingFile":
            picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item])
        case "newFile":
            // The picker can only place a file that exists, so an empty one is made here and moved
            // to wherever the user chooses. The first backup fills it.
            let suggested = SavedFile.safeName(body["suggested"] as? String ?? "hearth-backup.hearth")
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            let file = directory.appendingPathComponent(suggested)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try Data().write(to: file)
            } catch {
                reply(nil, error.localizedDescription)
                return
            }
            picker = UIDocumentPickerViewController(forExporting: [file], asCopy: false)
        default:
            reply(nil, "unknown picker mode")
            return
        }
        picker.delegate = self
        picking = (reply, mode != "folder")
        presentOnTop(picker)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let pending = picking else { return }
        picking = nil
        guard let url = urls.first else {
            pending.reply(NSNull(), nil)
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            // Kept across launches: the bookmark is the grant, and it survives the app closing.
            let ref = try url.bookmarkData().base64EncodedString()
            let location: [String: Any] = ["ref": ref, "name": url.lastPathComponent, "single": pending.single]
            pending.reply(location, nil)
        } catch {
            pending.reply(nil, error.localizedDescription)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        picking?.reply(NSNull(), nil)
        picking = nil
    }

    // MARK: - File calls

    private func run(_ op: String, _ body: [String: Any]) throws -> Any {
        switch op {
        case "status":
            let ref = try string(body, "ref")
            if ref == Self.icloud { return ["granted": Self.iCloudRoot() != nil, "ref": ref] as [String: Any] }
            guard let resolved = try? resolve(ref) else { return ["granted": false, "ref": ref] as [String: Any] }
            let (url, stale) = resolved
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            // A stale bookmark still opens; a fresh one is handed back for the page to keep.
            let fresh = stale ? (try? url.bookmarkData().base64EncodedString()) ?? ref : ref
            return ["granted": scoped, "ref": fresh] as [String: Any]
        case "release":
            // A bookmark is only data; forgetting it on the page side is the whole release.
            return NSNull()
        // The backup passphrase, kept in the Keychain so backups survive the app being closed.
        case "secretGet":
            let key = "secret:" + (try string(body, "name"))
            if let value = Keychain.read(key) { return value }
            return NSNull()
        case "secretSet":
            let key = "secret:" + (try string(body, "name"))
            Keychain.write(key, try string(body, "value"))
            return NSNull()
        case "secretDelete":
            Keychain.delete("secret:" + (try string(body, "name")))
            return NSNull()
        case "list":
            return try access(body) { (url: URL) -> [String] in
                try coordinated(reading: url) { dir in
                    try FileManager.default.contentsOfDirectory(atPath: dir.path).map(Self.visibleName)
                }
            }
        case "mkdir":
            let create = body["create"] as? Bool ?? false
            return try access(body) { (url: URL) -> Bool in
                var isDirectory: ObjCBool = false
                if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) {
                    return isDirectory.boolValue
                }
                guard create else { return false }
                try coordinated(writing: url, options: []) { dir in
                    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false)
                }
                return true
            }
        case "open":
            let data = try access(body) { (url: URL) -> Data? in
                try coordinated(reading: url) { (file: URL) -> Data? in
                    FileManager.default.fileExists(atPath: file.path) ? try Data(contentsOf: file) : nil
                }
            }
            guard let data else { return NSNull() }
            let handle = newHandle()
            reads[handle] = (data, 0)
            return handle
        case "chunk":
            let handle = try string(body, "handle")
            guard let read = reads[handle] else { throw Failure("no such read") }
            let end = min(read.offset + Self.chunkBytes, read.data.count)
            if read.offset >= end {
                reads[handle] = nil
                return ""
            }
            reads[handle] = (read.data, end)
            return read.data.subdata(in: read.offset..<end).base64EncodedString()
        case "create":
            let handle = newHandle()
            writes[handle] = (try string(body, "ref"), try path(body), try name(body), Data())
            return handle
        case "append":
            let handle = try string(body, "handle")
            guard var write = writes[handle],
                  let chunk = Data(base64Encoded: try string(body, "data"))
            else { throw Failure("no such write") }
            write.data.append(chunk)
            writes[handle] = write
            return NSNull()
        case "close":
            let handle = try string(body, "handle")
            // A read closed early (only a header was wanted) just lets go of its data.
            reads[handle] = nil
            guard let write = writes.removeValue(forKey: handle) else { return NSNull() }
            guard body["ok"] as? Bool == true else { return NSNull() }
            // Written whole, atomically, only now: an abandoned write never touches the file.
            try access(write.ref, write.path, write.name) { url in
                try coordinated(writing: url, options: .forReplacing) { file in
                    try write.data.write(to: file, options: .atomic)
                }
            }
            return NSNull()
        case "remove":
            return try access(body) { (url: URL) -> Bool in
                guard FileManager.default.fileExists(atPath: url.path) else { return false }
                try coordinated(writing: url, options: .forDeleting) { item in
                    try FileManager.default.removeItem(at: item)
                }
                return true
            }
        default:
            throw Failure("unknown call")
        }
    }

    private func newHandle() -> String {
        nextHandle += 1
        return String(nextHandle)
    }

    // MARK: - Resolving a target

    private func resolve(_ ref: String) throws -> (URL, Bool) {
        guard let data = Data(base64Encoded: ref) else { throw Failure("not a bookmark") }
        var stale = false
        let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        return (url, stale)
    }

    private func access<T>(_ body: [String: Any], _ work: (URL) throws -> T) throws -> T {
        try access(try string(body, "ref"), try path(body), try name(body), work)
    }

    /// Runs [work] on the picked item, or on `path/name` inside a picked folder, while the grant
    /// is open. `name` nil means the picked file itself.
    private func access<T>(_ ref: String, _ path: [String], _ name: String?, _ work: (URL) throws -> T) throws -> T {
        if ref == Self.icloud {
            guard var url = Self.iCloudRoot() else { throw Failure("iCloud Drive is off on this device") }
            for segment in path + (name.map { [$0] } ?? []) {
                url.appendPathComponent(segment)
            }
            return try work(url)
        }
        let (root, _) = try resolve(ref)
        guard root.startAccessingSecurityScopedResource() else {
            throw Failure("Hearth no longer has access to \(root.lastPathComponent)")
        }
        defer { root.stopAccessingSecurityScopedResource() }
        var url = root
        for segment in path + (name.map { [$0] } ?? []) {
            url.appendPathComponent(segment)
        }
        return try work(url)
    }

    /// A coordinated read: iCloud downloads an evicted file before [work] sees it.
    private func coordinated<T>(reading url: URL, _ work: (URL) throws -> T) throws -> T {
        var coordinationError: NSError?
        var result: Result<T, Error> = .failure(Failure("the file could not be reached"))
        NSFileCoordinator(filePresenter: nil).coordinate(
            readingItemAt: url, options: [], error: &coordinationError
        ) { item in
            result = Result { try work(item) }
        }
        if let coordinationError { throw coordinationError }
        return try result.get()
    }

    /// A coordinated write: the provider sees one finished change and syncs it.
    private func coordinated<T>(
        writing url: URL,
        options: NSFileCoordinator.WritingOptions,
        _ work: (URL) throws -> T
    ) throws -> T {
        var coordinationError: NSError?
        var result: Result<T, Error> = .failure(Failure("the file could not be reached"))
        NSFileCoordinator(filePresenter: nil).coordinate(
            writingItemAt: url, options: options, error: &coordinationError
        ) { item in
            result = Result { try work(item) }
        }
        if let coordinationError { throw coordinationError }
        return try result.get()
    }

    /// `Documents` in the app's iCloud container, which iCloud Drive shows as a "Hearth" folder
    /// (NSUbiquitousContainers in project.yml). Nil when the user is signed out of iCloud or has
    /// iCloud Drive off. Never call on the main thread: the first lookup can block.
    static func iCloudRoot() -> URL? {
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: nil) else { return nil }
        let documents = container.appendingPathComponent("Documents", isDirectory: true)
        try? FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        return documents
    }

    // MARK: - Arguments

    private func string(_ body: [String: Any], _ key: String) throws -> String {
        guard let value = body[key] as? String else { throw Failure("missing \(key)") }
        return value
    }

    private func path(_ body: [String: Any]) throws -> [String] {
        try (body["path"] as? [String] ?? []).map(Self.checkedName)
    }

    private func name(_ body: [String: Any]) throws -> String? {
        guard let value = body["name"] as? String else { return nil }
        return try Self.checkedName(value)
    }

    /// A name inside the picked folder. The bookmark is what keeps the page inside it — a path that
    /// climbs out of the folder is outside the grant and fails anyway — but a separator or a dot
    /// segment is never something the web app meant to send.
    static func checkedName(_ name: String) throws -> String {
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\0") else {
            throw Failure("not a file name")
        }
        return name
    }

    /// iCloud lists a file it has not downloaded as `.<name>.icloud`. The page asks about names, and
    /// a coordinated read of the real one fetches it.
    static func visibleName(_ entry: String) -> String {
        guard entry.hasPrefix("."), entry.hasSuffix(".icloud"), entry.count > ".icloud".count + 1 else {
            return entry
        }
        return String(entry.dropFirst().dropLast(".icloud".count))
    }
}
