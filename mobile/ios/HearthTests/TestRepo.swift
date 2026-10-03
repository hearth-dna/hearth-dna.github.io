import Foundation
@testable import Hearth

/// A repository over a fresh in-memory database and an empty blob folder of its own.
func makeTestRepo() throws -> Repo {
    let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("blobs-\(UUID().uuidString)", isDirectory: true)
    return try Repo(db: Db(path: ":memory:"), blobs: Blobs(folder: folder))
}
