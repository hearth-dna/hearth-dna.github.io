import SwiftUI
import UIKit
import WebKit

/// The web view, and the three things a web app cannot do for itself on iOS: open a link outside
/// itself, hand the user a file, and keep a backup in a folder or file the user picked
/// (NativeFiles.swift).
///
/// It draws edge to edge (see HearthApp) and leaves the safe area to the page: the web app sets
/// `viewport-fit=cover` and pads its own translucent top bar and tab bar with
/// `env(safe-area-inset-*)`, so content scrolls under the status bar and home indicator the way it
/// does in a native iOS app. For that, the scroll view must not add the same insets a second time.
struct WebAppView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        // A tap must never open a page inside the app's own origin-bearing web view; links go to
        // Safari (see the navigation delegate below), and a window.open target has nowhere to go.
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        // The backup place (Settings → Backup): a folder or file from the Files picker, which is
        // how iCloud Drive, Google Drive and Dropbox reach other apps. Page world only, and the
        // handler itself refuses any origin but the app's own.
        configuration.userContentController.addScriptMessageHandler(
            context.coordinator.files, contentWorld: .page, name: NativeFiles.name
        )

        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.allowsLinkPreview = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        // The page's own background (the launch colour is the same one), so the frames before the
        // first paint are not white in dark mode.
        web.isOpaque = false
        web.backgroundColor = UIColor(named: "LaunchBackground")
        web.scrollView.backgroundColor = UIColor(named: "LaunchBackground")
        #if DEBUG
        // Safari's Web Inspector, debug builds only. The web app's own console is the only way to
        // see what the database worker is doing.
        web.isInspectable = true
        #endif
        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKDownloadDelegate {
        let files = NativeFiles()

        /// Where each running download is being written. Keyed by the download, cleared when it
        /// finishes or fails.
        private var destinations: [ObjectIdentifier: URL] = [:]

        // MARK: - Navigation

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            // An <a download> — the export path. WebKit handles the blob: URL itself, which is the
            // one thing Android's WebView cannot do and has to be bridged for by hand.
            if navigationAction.shouldPerformDownload {
                decisionHandler(.download)
                return
            }
            if let target = navigationAction.request.url,
               navigationAction.navigationType == .linkActivated,
               target.host != "127.0.0.1" {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            navigationAction: WKNavigationAction,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func webView(
            _ webView: WKWebView,
            navigationResponse: WKNavigationResponse,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        // MARK: - Downloads

        func download(
            _ download: WKDownload,
            decideDestinationUsing response: URLResponse,
            suggestedFilename: String,
            completionHandler: @escaping (URL?) -> Void
        ) {
            // A fresh directory per download: WKDownload refuses a destination that already
            // exists, and two exports on the same day have the same name by design.
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            } catch {
                completionHandler(nil)
                return
            }
            let destination = directory.appendingPathComponent(SavedFile.safeName(suggestedFilename))
            destinations[ObjectIdentifier(download)] = destination
            completionHandler(destination)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let file = destinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
            // The share sheet, not a silent save: on iOS the user picks where a file goes — Files,
            // AirDrop, another app — and a dump they cannot find is a backup they do not have.
            presentOnTop(UIActivityViewController(activityItems: [file], applicationActivities: nil))
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            if let file = destinations.removeValue(forKey: ObjectIdentifier(download)) {
                try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
            }
        }
    }
}

/// Shows a system sheet (the share sheet, the document picker) over whatever is on screen.
func presentOnTop(_ controller: UIViewController) {
    let scene = UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive }
    guard let window = (scene as? UIWindowScene)?.keyWindow,
          var top = window.rootViewController
    else { return }
    while let presented = top.presentedViewController { top = presented }
    // An iPad share sheet is a popover and needs an anchor, or it crashes on presentation.
    controller.popoverPresentationController?.sourceView = window
    controller.popoverPresentationController?.sourceRect = CGRect(
        x: window.bounds.midX, y: window.bounds.maxY, width: 0, height: 0
    )
    top.present(controller, animated: true)
}

/// The name a downloaded file is written under.
enum SavedFile {
    /// Strips everything a file name must not carry: path separators (a name is not a location)
    /// and control characters. The web app's own names — `hearth-dump-2026-09-19.hearth` — pass
    /// through untouched; this is for what a future caller might suggest.
    static func safeName(_ suggested: String) -> String {
        let flattened = suggested
            .split(whereSeparator: { $0 == "/" || $0 == "\\" })
            .last
            .map(String.init) ?? ""
        let cleaned = flattened
            .filter { !$0.unicodeScalars.contains { scalar in scalar.value < 0x20 } }
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "hearth-export.bin" : String(cleaned.prefix(120))
    }
}
