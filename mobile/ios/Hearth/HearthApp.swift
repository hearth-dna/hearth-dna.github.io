import SwiftUI

/// The whole iOS app: a local server for the bundled PWA, and a web view pointed at it.
///
/// There is no native model layer, and there must not be one — the genome, the pedigree and every
/// analysis live in the web app's SQLite database inside WebKit's storage
/// (../../docs/decisions/0006-native-shells-around-the-pwa.md).
@main
struct HearthApp: App {
    private let server: LocalWebServer?
    private let failure: Failure?

    init() {
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
            if let server {
                WebAppView(url: server.url)
            } else if let failure {
                FailureView(failure: failure)
            }
        }
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
