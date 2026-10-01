import XCTest
@testable import Hearth

/// The native schema is the web's, character for character (ADR 0010): a copy that drifts would
/// write rows the other apps cannot restore, or fail to restore theirs.
final class SchemaTests: XCTestCase {
    func testSchemaMatchesTheWebApp() throws {
        let schemaFile = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // HearthTests
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // mobile
            .deletingLastPathComponent() // repository root
            .appendingPathComponent("frontend/src/db/schema.ts")
        let source = try String(contentsOf: schemaFile, encoding: .utf8)
        let opening = "export const SCHEMA_SQL = `"
        let start = try XCTUnwrap(source.range(of: opening), "no SCHEMA_SQL in schema.ts").upperBound
        let end = try XCTUnwrap(source[start...].firstIndex(of: "`"), "SCHEMA_SQL is not closed")
        XCTAssertEqual(SCHEMA_SQL, String(source[start..<end]))
    }

    /// The schema runs on the system SQLite, and running it again changes nothing.
    func testSchemaOpensTwice() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).db").path
        defer { try? FileManager.default.removeItem(atPath: path) }
        _ = try Db(path: path)
        let db = try Db(path: path)
        let tables = try db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map { $0.text("name") }
        XCTAssertEqual(
            tables,
            ["attachment", "chat", "consent", "genotype", "health_log", "meta", "note", "person", "relationship",
             "sharing_log", "source_file"]
        )
        XCTAssertEqual(try db.query("SELECT COUNT(*) AS n FROM meta").first?.int("n"), 3)
    }
}
