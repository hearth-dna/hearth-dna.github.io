import Foundation

/// The files kept next to the database (the web's OPFS file cache, `db.filePut` and friends):
/// gzipped genome originals and attached documents, by name. Names come from content hashes built
/// in code (`genome-<sha>.gz`), never from anything a user typed or a file carried.
final class Blobs {
    let folder: URL

    init(folder: URL) {
        self.folder = folder
    }

    /// `blobs/` in Application Support, beside `user.db` and, like it, kept out of iCloud and
    /// iTunes backups (see `Db.openDefault`): the family's genomes leave the phone only in a backup
    /// the user makes.
    static func openDefault() throws -> Blobs {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        var folder = support.appendingPathComponent("blobs", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
        return Blobs(folder: folder)
    }

    /// Written to a temporary file and moved into place, so a crash never leaves half a file under
    /// the real name.
    func put(_ name: String, _ data: Data) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try data.write(to: url(name), options: .atomic)
    }

    func get(_ name: String) -> Data? {
        try? Data(contentsOf: url(name))
    }

    func delete(_ name: String) {
        try? FileManager.default.removeItem(at: url(name))
    }

    /// Every stored name, sorted; nothing when the folder does not exist yet.
    func list() -> [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        return names.filter { !$0.hasPrefix(".") }.sorted()
    }

    private func url(_ name: String) -> URL {
        folder.appendingPathComponent(name, isDirectory: false)
    }
}
