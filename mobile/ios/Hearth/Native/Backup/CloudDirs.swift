import Foundation

/// Access tokens for a cloud place, blocking until Cloud.swift answers; `fresh` asks past a cached
/// one the provider refused. Called on the backup's queue, never the main thread.
typealias TokenSource = (_ fresh: Bool) throws -> String

/// The provider refused the grant: the user has to sign in again.
struct SignInNeeded: LocalizedError {
    let provider: String
    var errorDescription: String? {
        "\(provider == "google" ? "Google Drive" : "Dropbox") needs you to sign in again"
    }
}

/// Google Drive and Dropbox as a backup place (backup/cloud.ts, ADR 0009), over each provider's
/// REST API and through Egress only.
enum CloudDirs {
    static func encode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    static func url(_ s: String) throws -> URL {
        guard let u = URL(string: s) else { throw DbError(message: "bad address \(s)") }
        return u
    }

    /// One authorised call, retried once with a fresh token when the cached one has expired.
    static func send(
        _ provider: String, _ token: TokenSource, _ method: String, _ address: String,
        headers: [String: String] = [:], body: Data? = nil
    ) throws -> Egress.Response {
        let target = try url(address)
        let cached = try token(false)
        var r = try Egress.call(method, target, headers: headers.merging(["Authorization": "Bearer " + cached]) { $1 }, body: body)
        if r.status == 401 {
            let fresh = try token(true)
            r = try Egress.call(method, target, headers: headers.merging(["Authorization": "Bearer " + fresh]) { $1 }, body: body)
        }
        if r.status == 401 { throw SignInNeeded(provider: provider) }
        return r
    }

    static func ok(_ r: Egress.Response, _ what: String) throws -> Egress.Response {
        guard r.ok else { throw DbError(message: "\(what) failed (\(r.status))") }
        return r
    }

    static func object(_ r: Egress.Response) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: r.body)) as? [String: Any] ?? [:]
    }

    static func json(_ o: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: o, options: [.withoutEscapingSlashes])) ?? Data("{}".utf8)
    }
}

// MARK: - Google Drive

struct DriveFolder: Identifiable, Equatable {
    let id: String
    let name: String
    var parents: [String] = []
}

private let drive = "https://www.googleapis.com/drive/v3/files"
private let driveUpload = "https://www.googleapis.com/upload/drive/v3/files"
private let driveFolderType = "application/vnd.google-apps.folder"

/// Drive's query language quotes with single quotes and escapes with a backslash.
private func quote(_ s: String) -> String {
    "'" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'") + "'"
}

private func driveList(_ token: TokenSource, _ q: String, fields: String, extra: String = "") throws -> [[String: Any]] {
    var out: [[String: Any]] = []
    var page = ""
    repeat {
        var address = "\(drive)?q=\(CloudDirs.encode(q))&fields=\(CloudDirs.encode("nextPageToken,files(\(fields))"))&pageSize=1000&spaces=drive\(extra)"
        if !page.isEmpty { address += "&pageToken=\(CloudDirs.encode(page))" }
        let body = CloudDirs.object(try CloudDirs.ok(CloudDirs.send("google", token, "GET", address), "listing Google Drive"))
        out += body["files"] as? [[String: Any]] ?? []
        page = body["nextPageToken"] as? String ?? ""
    } while !page.isEmpty
    return out
}

private func folder(_ f: [String: Any]) -> DriveFolder {
    DriveFolder(id: f["id"] as? String ?? "", name: f["name"] as? String ?? "", parents: f["parents"] as? [String] ?? [])
}

private func makeFolder(_ token: TokenSource, _ name: String, _ parent: String) throws -> String {
    let r = try CloudDirs.ok(CloudDirs.send(
        "google", token, "POST", "\(drive)?fields=id", headers: ["content-type": "application/json"],
        body: CloudDirs.json(["name": name, "mimeType": driveFolderType, "parents": [parent]])
    ), "creating a Google Drive folder")
    guard let id = CloudDirs.object(r)["id"] as? String else { throw DbError(message: "Google Drive made no folder") }
    return id
}

/// What the Drive folder chooser needs: folders by name, those that hold a backup, and the path
/// of one for display. Blocking calls: use them off the main thread.
final class DriveFolders {
    private let token: TokenSource
    private let onlyFolders = "mimeType = '\(driveFolderType)' and trashed = false"
    private var known: [String: DriveFolder] = [:]

    init(token: @escaping TokenSource) {
        self.token = token
    }

    func search(_ text: String) throws -> [DriveFolder] {
        let found = try driveList(token, "name contains \(quote(text)) and \(onlyFolders)", fields: "id,name,parents", extra: "&orderBy=name")
            .prefix(50).map(folder)
        for f in found { known[f.id] = f }
        return found
    }

    /// Folders that already hold the snapshot: the backup made on another device is one tap away.
    func withBackup() throws -> [DriveFolder] {
        let files = try driveList(token, "name = \(quote(Backup.snapshot)) and trashed = false", fields: "id,name,parents")
        var ids: [String] = []
        for p in files.flatMap({ $0["parents"] as? [String] ?? [] }) where !ids.contains(p) { ids.append(p) }
        return ids.compactMap(node)
    }

    private func node(_ id: String) -> DriveFolder? {
        if let f = known[id] { return f }
        guard let r = try? CloudDirs.send("google", token, "GET", "\(drive)/\(id)?fields=\(CloudDirs.encode("id,name,parents"))"),
              r.ok
        else { return nil }
        let f = folder(CloudDirs.object(r))
        known[id] = f
        return f
    }

    /// "My Drive › Backups › Hearth" for display: the folders above `id`, the folder last.
    func path(_ id: String) -> String {
        let top = node("root")?.id ?? "root"
        var out: [String] = []
        var at = node(id)
        while let current = at, out.count < 30 {
            out.insert(current.name, at: 0)
            guard let up = current.parents.first, up != top else { break }
            at = node(up)
        }
        return out.joined(separator: " › ")
    }
}

/// Who signed in, from Drive itself.
func driveAccount(_ token: TokenSource) throws -> String {
    let r = try CloudDirs.ok(
        CloudDirs.send("google", token, "GET", "https://www.googleapis.com/drive/v3/about?fields=\(CloudDirs.encode("user(emailAddress)"))"),
        "asking Google Drive who signed in"
    )
    return (CloudDirs.object(r)["user"] as? [String: Any])?["emailAddress"] as? String ?? ""
}

/// Backups in the Drive folder `folderId`, or in a `Hearth` folder in My Drive when none was chosen.
final class GoogleDriveDir: BackupDir {
    let name: String
    let single = false
    let versioned = true
    private let token: TokenSource
    private let fixedId: String?
    private var resolvedId: String?
    private var cache: [String: (id: String, folder: Bool)]?

    init(token: @escaping TokenSource, name: String, folderId: String?) {
        self.token = token
        self.name = name
        fixedId = folderId
    }

    /// The folder's id: the chosen one, or `Hearth` in My Drive, found (or made) on first use.
    private func id() throws -> String {
        if let fixedId { return fixedId }
        if let resolvedId { return resolvedId }
        let top = try driveList(token, "'root' in parents and trashed = false and name = 'Hearth' and mimeType = '\(driveFolderType)'", fields: "id,name")
        let made = try (top.first?["id"] as? String) ?? makeFolder(token, "Hearth", "root")
        resolvedId = made
        return made
    }

    private func entries() throws -> [String: (id: String, folder: Bool)] {
        var out: [String: (id: String, folder: Bool)] = [:]
        let folderId = try id()
        for f in try driveList(token, "\(quote(folderId)) in parents and trashed = false", fields: "id,name,mimeType") {
            guard let n = f["name"] as? String, let i = f["id"] as? String, out[n] == nil else { continue }
            out[n] = (i, f["mimeType"] as? String == driveFolderType)
        }
        cache = out
        return out
    }

    private func find(_ child: String) throws -> (id: String, folder: Bool)? {
        if let hit = cache?[child] { return hit }
        return try entries()[child]
    }

    func names() throws -> [String] { Array(try entries().keys) }

    private func media(_ child: String, range: Int?) throws -> Data? {
        guard let e = try find(child), !e.folder else { return nil }
        let headers = range.map { ["range": "bytes=0-\($0 - 1)"] } ?? [:]
        let r = try CloudDirs.send("google", token, "GET", "\(drive)/\(e.id)?alt=media", headers: headers)
        if r.status == 404 { return nil }
        return try CloudDirs.ok(r, "reading \(child)").body
    }

    func read(_ child: String) throws -> Data? { try media(child, range: nil) }

    func readHead(_ child: String, bytes: Int) throws -> Data? { try media(child, range: bytes) }

    /// Two-step resumable upload: no size ceiling, unlike the 5 MB simple and multipart ones.
    func write(_ child: String, _ data: Data) throws {
        let existing = try find(child).flatMap { $0.folder ? nil : $0.id }
        var meta: [String: Any] = [:]
        if existing == nil { meta = ["name": child, "parents": [try id()]] }
        let start = try CloudDirs.ok(CloudDirs.send(
            "google", token, existing == nil ? "POST" : "PATCH",
            "\(driveUpload)\(existing.map { "/\($0)" } ?? "")?uploadType=resumable",
            headers: ["content-type": "application/json; charset=UTF-8"], body: CloudDirs.json(meta)
        ), "starting the upload of \(child)")
        guard let session = start.headers["location"] else { throw DbError(message: "Google Drive did not return an upload address") }
        _ = try CloudDirs.ok(CloudDirs.send("google", token, "PUT", session, body: data), "uploading \(child)")
        cache = nil
    }

    /// To the bin, not gone: Drive keeps it for 30 days, the undo the user expects.
    func remove(_ child: String) throws {
        guard let e = try find(child) else { return }
        _ = try CloudDirs.ok(CloudDirs.send(
            "google", token, "PATCH", "\(drive)/\(e.id)", headers: ["content-type": "application/json"],
            body: Data(#"{"trashed":true}"#.utf8)
        ), "deleting \(child)")
        cache = nil
    }

    func subdir(_ child: String, create: Bool) throws -> BackupDir? {
        let e = try find(child)
        if let e, e.folder { return GoogleDriveDir(token: token, name: child, folderId: e.id) }
        if e != nil || !create { return nil }
        let parent = try id()
        let made = try makeFolder(token, child, parent)
        cache = nil
        return GoogleDriveDir(token: token, name: child, folderId: made)
    }
}

// MARK: - Dropbox

private let dropboxAPI = "https://api.dropboxapi.com/2"
private let dropboxContent = "https://content.dropboxapi.com/2"

/// Dropbox wants its JSON argument header in ASCII, anything else escaped.
private func dropboxArg(_ o: [String: Any]) -> String {
    var out = ""
    for unit in String(decoding: CloudDirs.json(o), as: UTF8.self).utf16 {
        if unit >= 0x7f { out += String(format: "\\u%04x", unit) } else { out.unicodeScalars.append(Unicode.Scalar(unit)!) }
    }
    return out
}

/// The app folder (`Apps/<app name>`): Dropbox's root for this app is the empty path.
final class DropboxDir: BackupDir {
    let name: String
    let single = false
    let versioned = true
    private let token: TokenSource
    private let path: String

    init(token: @escaping TokenSource, name: String, path: String = "") {
        self.token = token
        self.name = name
        self.path = path
    }

    private func at(_ child: String) -> String { "\(path)/\(child)" }

    private func rpc(_ endpoint: String, _ arg: [String: Any]) throws -> Egress.Response {
        try CloudDirs.send("dropbox", token, "POST", "\(dropboxAPI)/\(endpoint)", headers: ["content-type": "application/json"], body: CloudDirs.json(arg))
    }

    /// 409 is Dropbox's "the path is not there" (and every other request-level refusal).
    private func missing(_ r: Egress.Response) -> Bool { r.status == 409 }

    func names() throws -> [String] {
        var r = try rpc("files/list_folder", ["path": path, "limit": 2000])
        if missing(r) { return [] }
        var out: [String] = []
        while true {
            let body = CloudDirs.object(try CloudDirs.ok(r, "listing Dropbox"))
            out += (body["entries"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
            guard body["has_more"] as? Bool == true, let cursor = body["cursor"] as? String else { return out }
            r = try rpc("files/list_folder/continue", ["cursor": cursor])
        }
    }

    private func download(_ child: String, range: Int?) throws -> Data? {
        var headers = ["dropbox-api-arg": dropboxArg(["path": at(child)])]
        if let range { headers["range"] = "bytes=0-\(range - 1)" }
        let r = try CloudDirs.send("dropbox", token, "POST", "\(dropboxContent)/files/download", headers: headers)
        if missing(r) { return nil }
        return try CloudDirs.ok(r, "reading \(child)").body
    }

    func read(_ child: String) throws -> Data? { try download(child, range: nil) }

    func readHead(_ child: String, bytes: Int) throws -> Data? { try download(child, range: bytes) }

    func write(_ child: String, _ data: Data) throws {
        _ = try CloudDirs.ok(CloudDirs.send(
            "dropbox", token, "POST", "\(dropboxContent)/files/upload",
            headers: [
                "content-type": "application/octet-stream",
                "dropbox-api-arg": dropboxArg(["path": at(child), "mode": "overwrite", "mute": true]),
            ],
            body: data
        ), "uploading \(child)")
    }

    func remove(_ child: String) throws {
        let r = try rpc("files/delete_v2", ["path": at(child)])
        if !missing(r) { _ = try CloudDirs.ok(r, "deleting \(child)") }
    }

    func subdir(_ child: String, create: Bool) throws -> BackupDir? {
        let r = try rpc("files/get_metadata", ["path": at(child)])
        if r.ok {
            return CloudDirs.object(r)[".tag"] as? String == "folder" ? DropboxDir(token: token, name: child, path: at(child)) : nil
        }
        if !missing(r) { _ = try CloudDirs.ok(r, "opening \(child)") }
        guard create else { return nil }
        _ = try CloudDirs.ok(try rpc("files/create_folder_v2", ["path": at(child), "autorename": false]), "creating \(child)")
        return DropboxDir(token: token, name: child, path: at(child))
    }
}
