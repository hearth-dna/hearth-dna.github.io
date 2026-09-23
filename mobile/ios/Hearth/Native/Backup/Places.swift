import Foundation

/// A folder or a file on the phone as a backup place: one the Files picker granted (kept as a
/// security-scoped bookmark, a grant to that one item, useless outside this app), or Hearth's own
/// folder in iCloud Drive. Every read and write goes through `NSFileCoordinator`, which is what
/// makes iCloud and the file providers download an evicted file first and sync a finished change.
enum PlaceAccess {
    /// A bookmark for a picked URL, as a string to keep; call while its security scope is open.
    static func bookmark(_ url: URL) throws -> String {
        try url.bookmarkData().base64EncodedString()
    }

    /// The URL a bookmark points at; throws when it no longer resolves.
    static func resolve(_ ref: String) throws -> URL {
        guard let data = Data(base64Encoded: ref) else { throw DbError(message: "not a bookmark") }
        var stale = false
        return try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
    }

    /// Whether the grant still opens.
    static func granted(_ ref: String) -> Bool {
        guard let url = try? resolve(ref) else { return false }
        let scoped = url.startAccessingSecurityScopedResource()
        if scoped { url.stopAccessingSecurityScopedResource() }
        return scoped
    }

    /// Runs `work` on the bookmarked item while its grant is open.
    static func withAccess<T>(_ ref: String, _ work: (URL) throws -> T) throws -> T {
        let url = try resolve(ref)
        guard url.startAccessingSecurityScopedResource() else {
            throw DbError(message: "Hearth no longer has access to \(url.lastPathComponent)")
        }
        defer { url.stopAccessingSecurityScopedResource() }
        return try work(url)
    }

    /// A coordinated read: iCloud downloads an evicted file before `work` sees it.
    static func reading<T>(_ url: URL, _ work: (URL) throws -> T) throws -> T {
        var failure: NSError?
        var result: Result<T, Error> = .failure(DbError(message: "the file could not be reached"))
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &failure) { item in
            result = Result { try work(item) }
        }
        if let failure { throw failure }
        return try result.get()
    }

    /// A coordinated write: the provider sees one finished change and syncs it.
    static func writing<T>(_ url: URL, _ options: NSFileCoordinator.WritingOptions, _ work: (URL) throws -> T) throws -> T {
        var failure: NSError?
        var result: Result<T, Error> = .failure(DbError(message: "the file could not be reached"))
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: options, error: &failure) { item in
            result = Result { try work(item) }
        }
        if let failure { throw failure }
        return try result.get()
    }
}

/// A folder backup place: a picked folder (`ref` is its bookmark) or iCloud Drive (`ref` nil), and
/// `path` below it for the attachments and genomes folders.
struct FolderDir: BackupDir {
    let ref: String?
    let name: String
    var path: [String] = []
    let single = false
    let versioned = false

    private func url(_ root: URL, _ child: String?) throws -> URL {
        var url = root
        for segment in path + (child.map { [$0] } ?? []) {
            url.appendPathComponent(try NativeFiles.checkedName(segment))
        }
        return url
    }

    /// Runs `work` on `child` (or this folder) while the grant is open.
    private func at<T>(_ child: String?, _ work: (URL) throws -> T) throws -> T {
        if let ref { return try PlaceAccess.withAccess(ref) { root in try work(try url(root, child)) } }
        guard let root = NativeFiles.iCloudRoot() else { throw DbError(message: "iCloud Drive is off on this device") }
        return try work(try url(root, child))
    }

    private static func exists(_ url: URL) -> (exists: Bool, directory: Bool) {
        var isDirectory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory)
        return (exists, isDirectory.boolValue)
    }

    func names() throws -> [String] {
        try at(nil) { url in
            guard FolderDir.exists(url).directory else { return [] }
            return try PlaceAccess.reading(url) { dir in
                try FileManager.default.contentsOfDirectory(atPath: dir.path).map(NativeFiles.visibleName)
            }
        }
    }

    func read(_ name: String) throws -> Data? {
        try at(name) { url in
            try PlaceAccess.reading(url) { file in
                try FileManager.default.fileExists(atPath: file.path) ? Data(contentsOf: file) : nil
            }
        }
    }

    func readHead(_ name: String, bytes: Int) throws -> Data? {
        try at(name) { url in
            try PlaceAccess.reading(url) { file -> Data? in
                guard FileManager.default.fileExists(atPath: file.path) else { return nil }
                let handle = try FileHandle(forReadingFrom: file)
                defer { try? handle.close() }
                return try handle.read(upToCount: bytes) ?? Data()
            }
        }
    }

    func write(_ name: String, _ data: Data) throws {
        try at(name) { url in
            try PlaceAccess.writing(url, .forReplacing) { file in try data.write(to: file, options: .atomic) }
        }
    }

    func remove(_ name: String) throws {
        try at(name) { url in
            guard FolderDir.exists(url).exists else { return }
            try PlaceAccess.writing(url, .forDeleting) { item in try FileManager.default.removeItem(at: item) }
        }
    }

    func subdir(_ name: String, create: Bool) throws -> BackupDir? {
        let found: Bool = try at(name) { url in
            let state = FolderDir.exists(url)
            if state.exists { return state.directory }
            guard create else { return false }
            try PlaceAccess.writing(url, []) { dir in try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
            return true
        }
        return found ? FolderDir(ref: ref, name: name, path: path + [name]) : nil
    }
}

/// A single picked file: it holds the snapshot and nothing beside it.
struct FileDir: BackupDir {
    let ref: String
    let name: String
    let single = true
    let versioned = false

    private func only(_ n: String) throws {
        guard n == Backup.snapshot else { throw DbError(message: "\(name) is a single file and holds only the snapshot") }
    }

    func names() throws -> [String] { [Backup.snapshot] }

    func read(_ n: String) throws -> Data? {
        guard n == Backup.snapshot else { return nil }
        return try PlaceAccess.withAccess(ref) { url in
            try PlaceAccess.reading(url) { file in
                try FileManager.default.fileExists(atPath: file.path) ? Data(contentsOf: file) : nil
            }
        }
    }

    func readHead(_ n: String, bytes: Int) throws -> Data? {
        try read(n).map { $0.prefix(bytes) }
    }

    func write(_ n: String, _ data: Data) throws {
        try only(n)
        try PlaceAccess.withAccess(ref) { url in
            try PlaceAccess.writing(url, .forReplacing) { file in try data.write(to: file, options: .atomic) }
        }
    }

    func remove(_ n: String) throws {
        try only(n)
        try PlaceAccess.withAccess(ref) { url in
            try PlaceAccess.writing(url, .forDeleting) { item in try FileManager.default.removeItem(at: item) }
        }
    }

    func subdir(_ name: String, create: Bool) throws -> BackupDir? { nil }
}
