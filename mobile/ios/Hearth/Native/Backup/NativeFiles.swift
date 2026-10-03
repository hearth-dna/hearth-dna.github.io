import Foundation

/// File-name rules and the iCloud container for the backup places (Places.swift).
enum NativeFiles {
    struct NameError: LocalizedError {
        var errorDescription: String? { "not a file name" }
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

    /// A name inside the picked folder. The bookmark is what keeps the app inside it (a path that
    /// climbs out of the folder is outside the grant and fails anyway), but a separator or a dot
    /// segment is never meant.
    static func checkedName(_ name: String) throws -> String {
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\0") else {
            throw NameError()
        }
        return name
    }

    /// iCloud lists a file it has not downloaded as `.<name>.icloud`; a coordinated read of the
    /// real name fetches it.
    static func visibleName(_ entry: String) -> String {
        guard entry.hasPrefix("."), entry.hasSuffix(".icloud"), entry.count > ".icloud".count + 1 else {
            return entry
        }
        return String(entry.dropFirst().dropLast(".icloud".count))
    }
}
