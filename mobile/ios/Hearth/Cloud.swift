import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

/// Signing in to Google Drive and Dropbox for backups (docs/decisions/0009-cloud-drive-buttons.md).
///
/// It touches nothing but credentials, and its requests go through Native/Egress.swift, the app's
/// one network gateway: it signs the user in, keeps the long-lived grant in the Keychain, and hands
/// the page short-lived access tokens on request. The backup itself (encrypted when the user set a passphrase) goes from the page through
/// `frontend/src/egress/egress.ts`, so the one place that decides what leaves the device stays one.
///
/// Both providers use OAuth with PKCE in `ASWebAuthenticationSession`, the system's sign-in sheet:
/// no client secret exists anywhere, only a public client id (Google's iOS client) or app key
/// (Dropbox), set at build time from the gitignored .env. Drive asks for the full `drive` scope so
/// the user can choose any folder (Hearth reads and writes only there); Dropbox keeps to an app folder.
final class Cloud: NSObject, ASWebAuthenticationPresentationContextProviding {
    /// The answer to a sign-in or token request: a value, or an error message.
    typealias Reply = (Any?, String?) -> Void

    struct Provider {
        let authorize: URL
        let token: URL
        let revoke: URL
        let clientID: String
        let redirect: String
        let scheme: String
        let extra: [URLQueryItem]
    }

    /// Access tokens already handed out, so a backup every few seconds does not refresh each time.
    /// Main thread only.
    private var tokens: [String: (token: String, until: Date)] = [:]
    private var session: ASWebAuthenticationSession?

    static func provider(_ name: String, bundle: Bundle = .main) -> Provider? {
        switch name {
        case "google":
            // An iOS OAuth client: `<id>.apps.googleusercontent.com`, whose reversed form is the
            // redirect scheme Google accepts for it.
            guard let id = setting("HearthGoogleClientID", bundle), id.hasSuffix(".apps.googleusercontent.com")
            else { return nil }
            let scheme = "com.googleusercontent.apps." + id.dropLast(".apps.googleusercontent.com".count)
            return Provider(
                authorize: URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!,
                token: URL(string: "https://oauth2.googleapis.com/token")!,
                revoke: URL(string: "https://oauth2.googleapis.com/revoke")!,
                clientID: id,
                redirect: "\(scheme):/oauth2redirect",
                scheme: scheme,
                extra: [URLQueryItem(name: "scope", value: "openid email https://www.googleapis.com/auth/drive")]
            )
        case "dropbox":
            guard let key = setting("HearthDropboxAppKey", bundle) else { return nil }
            return Provider(
                authorize: URL(string: "https://www.dropbox.com/oauth2/authorize")!,
                token: URL(string: "https://api.dropboxapi.com/oauth2/token")!,
                revoke: URL(string: "https://api.dropboxapi.com/2/auth/token/revoke")!,
                clientID: key,
                redirect: "db-\(key)://2/token",
                scheme: "db-\(key)",
                extra: [URLQueryItem(name: "token_access_type", value: "offline")]
            )
        default:
            return nil
        }
    }

    /// An Info.plist value filled from a build setting; empty or unexpanded means "not set up".
    private static func setting(_ key: String, _ bundle: Bundle) -> String? {
        guard let value = bundle.object(forInfoDictionaryKey: key) as? String,
              !value.isEmpty, !value.hasPrefix("$(")
        else { return nil }
        return value
    }

    // MARK: - The page's calls (main thread)

    func signIn(_ name: String, reply: @escaping Reply) {
        guard let provider = Self.provider(name) else {
            reply(nil, "\(name) is not set up for this build of Hearth")
            return
        }
        guard session == nil else {
            reply(nil, "a sign-in is already open")
            return
        }
        let verifier = Self.randomToken(48)
        let state = Self.randomToken(16)
        var url = URLComponents(url: provider.authorize, resolvingAgainstBaseURL: false)!
        url.queryItems = [
            URLQueryItem(name: "client_id", value: provider.clientID),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "redirect_uri", value: provider.redirect),
            URLQueryItem(name: "code_challenge", value: Self.challenge(verifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
        ] + provider.extra
        let sheet = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: provider.scheme) { [weak self] callback, error in
            DispatchQueue.main.async {
                self?.session = nil
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    reply(NSNull(), nil)
                    return
                }
                let items = callback.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems } ?? []
                let value = { (key: String) in items.first { $0.name == key }?.value }
                guard value("state") == state, let code = value("code") else {
                    // Denied on the provider's screen, or not the answer to our request.
                    reply(NSNull(), nil)
                    return
                }
                self?.exchange(name, provider, code: code, verifier: verifier, reply: reply)
            }
        }
        sheet.presentationContextProvider = self
        session = sheet
        if !sheet.start() {
            session = nil
            reply(nil, "could not open the sign-in sheet")
        }
    }

    /// A fresh access token, or NSNull when the user has to sign in again.
    func token(_ name: String, account: String, stale: String?, reply: @escaping Reply) {
        let key = "\(name):\(account)"
        if let cached = tokens[key], cached.token != stale, cached.until > Date() {
            reply(cached.token, nil)
            return
        }
        guard let provider = Self.provider(name), let refresh = Keychain.read(key) else {
            reply(NSNull(), nil)
            return
        }
        post(provider.token, form: [
            "grant_type": "refresh_token",
            "refresh_token": refresh,
            "client_id": provider.clientID,
        ]) { [weak self] result in
            switch result {
            case .success(let body):
                guard let access = body["access_token"] as? String else {
                    reply(nil, "the provider sent no token")
                    return
                }
                self?.remember(key, access, body["expires_in"])
                reply(access, nil)
            case .failure(let error as HTTPError) where error.status == 400:
                // The grant is gone (revoked, or the app unlinked): sign in again.
                Keychain.delete(key)
                reply(NSNull(), nil)
            case .failure(let error):
                reply(nil, error.localizedDescription)
            }
        }
    }

    func signOut(_ name: String, account: String, reply: @escaping Reply) {
        let key = "\(name):\(account)"
        tokens[key] = nil
        if let provider = Self.provider(name), let refresh = Keychain.read(key) {
            // Revoked at the provider too, so the grant is not just forgotten but dead. Best effort.
            if name == "google" {
                post(provider.revoke, form: ["token": refresh]) { _ in }
            } else {
                token(name, account: account, stale: nil) { access, _ in
                    guard let access = access as? String else { return }
                    Egress.request("POST", provider.revoke, headers: ["Authorization": "Bearer \(access)"]) { _ in }
                }
            }
        }
        Keychain.delete(key)
        reply(NSNull(), nil)
    }

    // MARK: - Tokens

    private func exchange(_ name: String, _ provider: Provider, code: String, verifier: String, reply: @escaping Reply) {
        post(provider.token, form: [
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": provider.clientID,
            "redirect_uri": provider.redirect,
        ]) { [weak self] result in
            guard case .success(let body) = result,
                  let access = body["access_token"] as? String,
                  let refresh = body["refresh_token"] as? String
            else {
                if case .failure(let error) = result { reply(nil, error.localizedDescription) }
                else { reply(nil, "the provider sent no token") }
                return
            }
            let (account, label) = Self.identity(name, body)
            Keychain.write("\(name):\(account)", refresh)
            self?.remember("\(name):\(account)", access, body["expires_in"])
            reply(["account": account, "label": label, "token": access] as [String: Any], nil)
        }
    }

    /// Who signed in: Dropbox says so in the token answer, Google in the ID token's claims (read
    /// for display only; it came straight from Google over TLS).
    static func identity(_ name: String, _ body: [String: Any]) -> (account: String, label: String) {
        if name == "dropbox" {
            let id = body["account_id"] as? String ?? "dropbox"
            return (id, "Dropbox")
        }
        let claims = (body["id_token"] as? String).flatMap(jwtClaims) ?? [:]
        let email = claims["email"] as? String ?? ""
        let subject = claims["sub"] as? String ?? email
        return (email.isEmpty ? subject : email, email.isEmpty ? "Google" : email)
    }

    static func jwtClaims(_ jwt: String) -> [String: Any]? {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var payload = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func remember(_ key: String, _ token: String, _ expiresIn: Any?) {
        // A minute early, so a token never expires between being handed out and being used.
        let seconds = (expiresIn as? NSNumber)?.doubleValue ?? 3600
        tokens[key] = (token, Date().addingTimeInterval(seconds - 60))
    }

    // MARK: - Plumbing

    struct HTTPError: LocalizedError {
        let status: Int
        var errorDescription: String? { "the provider answered \(status)" }
    }

    /// A form POST through the app's one network gateway (Native/Egress.swift); the JSON answer of
    /// a 2xx, delivered on the main thread.
    private func post(_ url: URL, form: [String: String], done: @escaping (Result<[String: Any], Error>) -> Void) {
        Egress.request(
            "POST", url,
            headers: ["Content-Type": "application/x-www-form-urlencoded"],
            body: Self.formBody(form).data(using: .utf8),
            timeout: 30
        ) { outcome in
            let result: Result<[String: Any], Error>
            switch outcome {
            case .success(let data):
                result = .success(((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:])
            case .failure(let error):
                if case .http(let status, _)? = error as? Egress.Failure {
                    result = .failure(HTTPError(status: status))
                } else {
                    result = .failure(error)
                }
            }
            DispatchQueue.main.async { done(result) }
        }
    }

    static func formBody(_ fields: [String: String]) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return fields.sorted { $0.key < $1.key }
            .map { key, value in
                "\(key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\(value.addingPercentEncoding(withAllowedCharacters: allowed)!)"
            }
            .joined(separator: "&")
    }

    /// RFC 7636 S256: base64url of the SHA-256 of the verifier, unpadded.
    static func challenge(_ verifier: String) -> String {
        base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func randomToken(_ count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return base64url(Data(bytes))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive }
        return (scene as? UIWindowScene)?.keyWindow ?? ASPresentationAnchor()
    }
}

/// Refresh tokens and the backup passphrase, one generic-password item each, readable only after
/// the first unlock and never migrating to another device through a backup.
enum Keychain {
    private static let service = "hearth.cloud"

    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func read(_ account: String) -> String? {
        var query = query(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ account: String, _ value: String) {
        delete(account)
        var item = query(account)
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    static func delete(_ account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }
}
