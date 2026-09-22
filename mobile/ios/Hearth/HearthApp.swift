import SwiftUI

/// The whole iOS app: a local server for the bundled PWA, and a web view pointed at it.
///
/// The family's data lives in the web app's SQLite database inside WebKit's storage
/// (../../docs/decisions/0006-native-shells-around-the-pwa.md). The native SwiftUI app that will
/// replace the web view (../../docs/decisions/0010-native-apps.md) is built alongside it, in
/// `Native/`, and until it reaches parity a debug build opens it only when launched with `-native`:
/// it has its own, separate database, and a release build never shows it.
@main
struct HearthApp: App {
    private let server: LocalWebServer?
    private let failure: Failure?

    init() {
        if HearthApp.native {
            server = nil
            failure = nil
            return
        }
        guard let root = LocalWebServer.bundledRoot() else {
            server = nil
            failure = .missingWebBundle
            return
        }
        let server = LocalWebServer(root: root)
        do {
            try server.start()
            self.server = server
            failure = nil
        } catch LocalWebServer.StartError.portUnavailable {
            self.server = nil
            failure = .portUnavailable
        } catch {
            self.server = nil
            failure = .missingWebBundle
        }
    }

    var body: some Scene {
        WindowGroup {
            if HearthApp.native {
                NativeRootView()
            } else if let server {
                // Edge to edge, keyboard included: the page pads itself with env(safe-area-inset-*),
                // and WKWebView scrolls a focused field above the keyboard on its own.
                WebAppView(url: server.url)
                    .ignoresSafeArea()
                    .background(Color("LaunchBackground").ignoresSafeArea())
            } else if let failure {
                FailureView(failure: failure)
            }
        }
    }

    /// Whether this launch is the native app (ADR 0010, staging step 1). Debug builds only: in
    /// Xcode, tick `-native` under the scheme's Run arguments, or pass it to `simctl launch`.
    private static var native: Bool {
        #if DEBUG
        return CommandLine.arguments.contains("-native")
        #else
        return false
        #endif
    }

    enum Failure {
        /// The app was built without `make mobile-web`, so there is no web app to serve.
        case missingWebBundle
        /// Port 17800 is taken. Deliberately not worked around: see LocalWebServer.port.
        case portUnavailable
    }
}

/// Shown instead of the app when it cannot start. Both cases are the developer's to fix or the
/// user's to resolve by closing whatever holds the port, so the text says which it is rather than
/// apologising in the abstract.
private struct FailureView: View {
    let failure: HearthApp.Failure

    var body: some View {
        VStack(spacing: 12) {
            Text("Hearth cannot start")
                .font(.headline)
            Text(message)
                .font(.callout)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(32)
    }

    private var message: String {
        switch failure {
        case .missingWebBundle:
            return "This build has no web app inside it. Run `make mobile-web` and build again."
        case .portUnavailable:
            return """
                Another app on this device is using port 17800, which Hearth needs to open its own \
                database. Close it and reopen Hearth.
                """
        }
    }
}
