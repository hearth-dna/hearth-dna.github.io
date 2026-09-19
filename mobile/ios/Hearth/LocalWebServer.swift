import Foundation
import Network
import os

/// Serves the bundled web build over `http://127.0.0.1:17800/`, to nothing but this app.
///
/// A WKWebView can load a local bundle three ways, and two of them cost the app its storage:
/// `file://` URLs are an opaque origin, and a custom `WKURLSchemeHandler` scheme is not a
/// *trustworthy* origin. OPFS, IndexedDB and the service worker are all partitioned per origin and
/// refused to both, so the SQLite database would fall back to memory and every import would vanish
/// when the app closed. `http://127.0.0.1` is the third way: loopback is on WebKit's
/// potentially-trustworthy list, so the web app gets a real, secure origin with no network behind
/// it. (Android reaches the same place with WebViewAssetLoader; see HearthWebView.kt.)
///
/// Nothing but the app's own read-only resources is reachable through it: the server answers GET
/// and HEAD, from one directory, with no directory listing and no write of any kind. The database
/// is in WebKit's storage, not here.
final class LocalWebServer {
    /// FIXED, never "any free port". The origin *is* the storage identity: a port picked at launch
    /// would give the app a new origin every run, and the family's whole database — OPFS, under
    /// `http://127.0.0.1:<port>` — would be invisible to the next launch. 17800 is in the
    /// ephemeral-port range's neighbourhood but outside IANA's registered list; when it is taken,
    /// [start] throws and the app says so rather than quietly moving.
    static let port: NWEndpoint.Port = 17_800

    enum StartError: Error {
        /// Another process holds 17800. See the note on [port] for why this is not worked around.
        case portUnavailable
        /// `Hearth/Web/` is missing from the bundle — `make mobile-web` was not run before building.
        case missingWebBundle
    }

    /// Where the web app lives: the `Web` folder reference from project.yml.
    let root: URL
    let url = URL(string: "http://127.0.0.1:\(port.rawValue)/")!

    private let queue = DispatchQueue(label: "hearth.localserver", qos: .userInitiated)
    private let log = Logger(subsystem: "hearth", category: "server")
    private var listener: NWListener?

    init(root: URL) {
        self.root = root
    }

    /// The bundled build, or nil when the app was built without running `make mobile-web`.
    static func bundledRoot(in bundle: Bundle = .main) -> URL? {
        guard let web = bundle.url(forResource: "Web", withExtension: nil),
              FileManager.default.fileExists(atPath: web.appendingPathComponent("index.html").path)
        else { return nil }
        return web
    }

    func start() throws {
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            throw StartError.missingWebBundle
        }
        let parameters = NWParameters.tcp
        // Loopback only. Without this the listener would accept from the local network, and the
        // app's own files would be served to anything on the same Wi-Fi.
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: Self.port)
        parameters.allowLocalEndpointReuse = true

        let listener: NWListener
        do {
            listener = try NWListener(using: parameters)
        } catch {
            throw StartError.portUnavailable
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - Connections

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        // One request per connection, then close. Static files over loopback are fast enough that
        // keep-alive would buy a millisecond and cost a state machine.
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, _, _ in
            guard let self else { return }
            let response = self.response(for: data.flatMap { String(data: $0, encoding: .utf8) })
            connection.send(content: response, completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    private func response(for request: String?) -> Data {
        guard let request, let line = request.split(separator: "\r\n").first else {
            return Self.head(status: "400 Bad Request", type: "text/plain", length: 0)
        }
        let parts = line.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else {
            return Self.head(status: "405 Method Not Allowed", type: "text/plain", length: 0)
        }
        guard let file = resolve(String(parts[1])), let body = try? Data(contentsOf: file) else {
            return Self.head(status: "404 Not Found", type: "text/plain", length: 0)
        }
        let head = Self.head(
            status: "200 OK",
            type: Self.mimeType(for: file.pathExtension),
            length: body.count
        )
        return parts[0] == "HEAD" ? head : head + body
    }

    private static func head(status: String, type: String, length: Int) -> Data {
        // No-store because the only copy that matters is the one in the app bundle: after an app
        // update, a cached response would be last week's build. The service worker does the real
        // caching, in the web app, where it belongs.
        let head = """
            HTTP/1.1 \(status)\r
            Content-Type: \(type)\r
            Content-Length: \(length)\r
            Cache-Control: no-store\r
            X-Content-Type-Options: nosniff\r
            Connection: close\r
            \r

            """
        return Data(head.utf8)
    }

    // MARK: - Paths

    /// Maps a request target onto a file in [root], or nil for a 404.
    ///
    /// Two rules beyond the obvious one. A path that escapes the root is refused outright rather
    /// than normalised, because "normalise then check" is how directory traversal gets through.
    /// And an extension-less path that matches no file is the app's own routing — `/people`,
    /// `/health` — so it gets `index.html`, the same fallback GitHub Pages serves through
    /// `404.html` (ADR 0005).
    func resolve(_ target: String) -> URL? {
        let path = target.split(separator: "?").first.map(String.init) ?? ""
        guard let decoded = path.removingPercentEncoding else { return nil }
        let components = decoded.split(separator: "/").map(String.init)
        guard !components.contains("..") && !components.contains(".") else { return nil }

        let relative = components.joined(separator: "/")
        if relative.isEmpty { return existing("index.html") }
        if let file = existing(relative) { return file }
        // Looks like a file (it has an extension): an honest 404, not the app shell.
        if components.last?.contains(".") == true { return nil }
        return existing("index.html")
    }

    private func existing(_ relative: String) -> URL? {
        let url = root.appendingPathComponent(relative)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              !isDirectory.boolValue
        else { return nil }
        return url
    }

    /// The types the build actually contains. `application/wasm` and `text/javascript` are the two
    /// that must be right: WebKit refuses to stream-compile or to run a module served as anything
    /// else, and both failures look like a blank page.
    static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json; charset=utf-8"
        case "wasm": return "application/wasm"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
