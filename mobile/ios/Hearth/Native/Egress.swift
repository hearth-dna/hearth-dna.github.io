import Foundation

/// The only code in the app that opens a network connection (ADR 0010, as egress.ts is on the web;
/// EgressTests fails if any other file names the APIs that can). There is no server of ours: the
/// destinations are the model provider the user brings a key for and the cloud drive the user signs
/// in to for backups, and a request to any other host is refused before a connection is opened.
///
/// Requests go over HTTPS only, with an ephemeral session (no cookies, no cache on disk) and no
/// redirects followed: a 3xx comes back as an error rather than taking the request elsewhere.
enum Egress {
    /// Every host the app may contact. Kept in step with the web's CSP and CLOUD_HOSTS, plus
    /// Google's OAuth token host, which the iOS sign-in exchanges and revokes its grant with
    /// (Android signs in through Play Services instead).
    static let hosts: Set<String> = [
        "generativelanguage.googleapis.com", // reading a document with the user's Gemini key
        "www.googleapis.com", // Google Drive backups
        "oauth2.googleapis.com", // Google sign-in: code exchange, refresh, revoke (iOS only)
        "api.dropboxapi.com", // Dropbox backups and sign-in
        "content.dropboxapi.com",
    ]

    static let geminiDefaultModel = "gemini-3.8-flash"
    private static let geminiURL = "https://generativelanguage.googleapis.com/v1beta/models"

    enum Failure: LocalizedError, Equatable {
        /// Not HTTPS, or a host outside `hosts`.
        case refused(String)
        /// A document send without the user's confirmation.
        case unconfirmed
        /// A direct provider call without a key.
        case noKey
        /// The provider answered with something other than 2xx.
        case http(status: Int, body: String)
        /// The provider answered 2xx with nothing usable.
        case empty

        var errorDescription: String? {
            switch self {
            case .refused(let host): return "refusing to contact \(host)"
            case .unconfirmed: return "refusing to send without an explicit confirmation"
            case .noKey: return "an API key is required for a direct provider call"
            case .http(let status, let body): return "the provider answered \(status): \(body.prefix(200))"
            case .empty: return "provider returned no text"
            }
        }
    }

    /// Throws unless `url` is HTTPS to an allowed host. Every request is checked here first.
    static func check(_ url: URL) throws {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(), hosts.contains(host) else {
            throw Failure.refused(url.host ?? url.absoluteString)
        }
    }

    /// One HTTPS request to an allowed host; `done` gets the body of a 2xx, else `Failure.http`,
    /// on a background queue. A refused destination fails before anything is sent.
    static func request(
        _ method: String, _ url: URL, headers: [String: String] = [:], body: Data? = nil,
        timeout: TimeInterval = 120, done: @escaping (Result<Data, Error>) -> Void
    ) {
        do {
            try check(url)
        } catch {
            done(.failure(error))
            return
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        request.httpBody = body
        session.dataTask(with: request) { data, response, error in
            if let error {
                done(.failure(error))
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let bytes = data ?? Data()
            if (200..<300).contains(status) {
                done(.success(bytes))
            } else {
                done(.failure(Failure.http(status: status, body: String(decoding: bytes, as: UTF8.self))))
            }
        }.resume()
    }

    /// What a provider answered: status, headers (lower-cased names) and body.
    struct Response {
        let status: Int
        let headers: [String: String]
        let body: Data

        var ok: Bool { (200..<300).contains(status) }
        var text: String { String(decoding: body, as: UTF8.self) }
    }

    /// One HTTPS request to an allowed host, whatever the status: the cloud drives answer "not
    /// there" and "sign in again" with statuses the caller acts on. Blocks until the answer is in,
    /// so it is for background queues only (the backup's); never call it on the main thread.
    static func call(
        _ method: String, _ url: URL, headers: [String: String] = [:], body: Data? = nil, timeout: TimeInterval = 120
    ) throws -> Response {
        precondition(!Thread.isMainThread, "Egress.call blocks; use it off the main thread")
        try check(url)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        request.httpBody = body
        let done = DispatchSemaphore(value: 0)
        var outcome: Result<Response, Error> = .failure(Failure.empty)
        session.dataTask(with: request) { data, response, error in
            if let error {
                outcome = .failure(error)
            } else {
                let http = response as? HTTPURLResponse
                var fields: [String: String] = [:]
                for (k, v) in http?.allHeaderFields ?? [:] {
                    if let k = k as? String { fields[k.lowercased()] = "\(v)" }
                }
                outcome = .success(Response(status: http?.statusCode ?? 0, headers: fields, body: data ?? Data()))
            }
            done.signal()
        }.resume()
        done.wait()
        return try outcome.get()
    }

    /// `request` for async callers.
    static func request(
        _ method: String, _ url: URL, headers: [String: String] = [:], body: Data? = nil, timeout: TimeInterval = 120
    ) async throws -> Data {
        try check(url)
        return try await withCheckedThrowingContinuation { continuation in
            request(method, url, headers: headers, body: body, timeout: timeout) { continuation.resume(with: $0) }
        }
    }

    /// One page of a document: its type and bytes.
    struct DocumentPart {
        let mime: String
        let data: Data
    }

    /// Sends the pages of one medical document straight to Gemini with the user's own key and
    /// returns the model's JSON text and the model that answered (egress.ts
    /// `readDocumentWithGemini`). `confirmedAt` is set by the confirmation the user tapped;
    /// nothing is sent without it.
    static func readDocumentWithGemini(
        key: String, model: String?, parts: [DocumentPart], prompt: String, schema: [String: Any], confirmedAt: String?
    ) async throws -> (text: String, model: String) {
        guard let confirmedAt, !confirmedAt.isEmpty else { throw Failure.unconfirmed }
        guard !key.isEmpty else { throw Failure.noKey }
        let m = (model?.isEmpty == false ? model : nil) ?? geminiDefaultModel
        var inline: [[String: Any]] = parts.map { p in
            ["inlineData": ["mimeType": p.mime, "data": p.data.base64EncodedString()]]
        }
        inline.append(["text": prompt])
        let payload: [String: Any] = [
            "contents": [["role": "user", "parts": inline] as [String: Any]],
            "generationConfig": [
                "temperature": 0, "responseMimeType": "application/json", "responseSchema": schema,
            ] as [String: Any],
        ]
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let encoded = m.addingPercentEncoding(withAllowedCharacters: allowed) ?? m
        guard let url = URL(string: "\(geminiURL)/\(encoded):generateContent") else { throw Failure.refused(m) }
        let data = try await request(
            "POST", url,
            headers: ["content-type": "application/json", "x-goog-api-key": key],
            body: try JSONSerialization.data(withJSONObject: payload)
        )
        let answer = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let candidate = (answer["candidates"] as? [[String: Any]])?.first
        let out = ((candidate?["content"] as? [String: Any])?["parts"] as? [[String: Any]]) ?? []
        let text = out.compactMap { $0["text"] as? String }.joined()
        if text.isEmpty { throw Failure.empty }
        let used = (answer["modelVersion"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? m
        return (text, used)
    }

    // MARK: - The session

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 120
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }()

    /// Answers every redirect with "do not follow", so the 3xx itself is what the caller sees.
    private final class NoRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(
            _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
            newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
        ) {
            completionHandler(nil)
        }
    }
}
