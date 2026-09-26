import XCTest
@testable import Hearth

/// The path and naming rules of the shell. Everything else in the app is WebKit's.
final class LocalWebServerTests: XCTestCase {
    private var root: URL!
    private var server: LocalWebServer!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("assets"), withIntermediateDirectories: true
        )
        try Data("<html></html>".utf8).write(to: root.appendingPathComponent("index.html"))
        try Data("body{}".utf8).write(to: root.appendingPathComponent("assets/app.css"))
        server = LocalWebServer(root: root)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: root)
    }

    func testServesTheAppShellAtTheRoot() {
        XCTAssertEqual(server.resolve("/")?.lastPathComponent, "index.html")
        XCTAssertEqual(server.resolve("")?.lastPathComponent, "index.html")
    }

    func testServesAFileThatExists() {
        XCTAssertEqual(server.resolve("/assets/app.css")?.lastPathComponent, "app.css")
    }

    func testIgnoresTheQueryString() {
        XCTAssertEqual(server.resolve("/assets/app.css?v=2")?.lastPathComponent, "app.css")
    }

    /// The web app's own routes: `/people` is not a file, and answering it with the shell is what
    /// makes a cold launch on a deep link work.
    func testFallsBackToTheShellForARoute() {
        XCTAssertEqual(server.resolve("/people")?.lastPathComponent, "index.html")
        XCTAssertEqual(server.resolve("/health/log")?.lastPathComponent, "index.html")
    }

    /// A missing *file* is a 404, not the shell: serving HTML where a script was expected turns a
    /// missing asset into a blank page with no error.
    func testAMissingFileIsNotTheShell() {
        XCTAssertNil(server.resolve("/assets/missing.js"))
    }

    func testRefusesTraversal() {
        XCTAssertNil(server.resolve("/../index.html"))
        XCTAssertNil(server.resolve("/assets/../../index.html"))
        // Percent-encoded, which is the form that gets past a check written on the raw string.
        XCTAssertNil(server.resolve("/%2e%2e/index.html"))
    }

    func testDirectoriesAreNotServed() {
        XCTAssertEqual(server.resolve("/assets")?.lastPathComponent, "index.html")
    }

    /// WebKit refuses to instantiate a module or stream-compile wasm served as anything else, and
    /// both failures look like a blank page rather than an error.
    func testMimeTypesTheBuildDependsOn() {
        XCTAssertEqual(LocalWebServer.mimeType(for: "js"), "text/javascript; charset=utf-8")
        XCTAssertEqual(LocalWebServer.mimeType(for: "wasm"), "application/wasm")
        XCTAssertEqual(LocalWebServer.mimeType(for: "webmanifest"), "application/manifest+json; charset=utf-8")
        XCTAssertEqual(LocalWebServer.mimeType(for: "hearth"), "application/octet-stream")
    }
}

final class SavedFileTests: XCTestCase {
    func testKeepsTheNameTheWebAppChose() {
        XCTAssertEqual(SavedFile.safeName("hearth-dump-2026-09-19.hearth"), "hearth-dump-2026-09-19.hearth")
    }

    func testANameIsNeverAPath() {
        XCTAssertEqual(SavedFile.safeName("../../etc/passwd"), "passwd")
        XCTAssertEqual(SavedFile.safeName("C:\\Windows\\dump.hearth"), "dump.hearth")
    }

    func testBlankNamesFallBack() {
        XCTAssertEqual(SavedFile.safeName("   "), "hearth-export.bin")
        XCTAssertEqual(SavedFile.safeName(""), "hearth-export.bin")
    }

    func testNamesStayShortEnoughForAnyFilesystem() {
        XCTAssertEqual(SavedFile.safeName(String(repeating: "a", count: 400)).count, 120)
    }

    /// The PDF reader's worker is a module script: WebKit refuses it under any other type.
    func testServesModuleScriptsAsJavaScript() {
        XCTAssertEqual(LocalWebServer.mimeType(for: "mjs"), "text/javascript; charset=utf-8")
    }
}
