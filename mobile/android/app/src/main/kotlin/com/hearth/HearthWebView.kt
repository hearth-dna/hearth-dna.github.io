package com.hearth

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader

/**
 * Builds the one WebView the app has.
 *
 * The single decision that matters here is the origin. Loading the bundle from `file://` would
 * cost the app its storage: OPFS, IndexedDB and the service worker are all partitioned per origin
 * and unavailable to opaque ones, so the SQLite database would fall back to memory and every
 * import would vanish on exit. [WebViewAssetLoader] serves the same files over
 * `https://appassets.androidplatform.net/`, which the WebView treats as a normal secure origin —
 * a real origin, backed by no network.
 */
object HearthWebView {
    private const val DOMAIN = "appassets.androidplatform.net"

    /** Where `make mobile-web` puts `frontend/dist/`, inside `src/main/assets/`. */
    private const val WEB_DIR = "web/"
    const val START_URL = "https://$DOMAIN/index.html"

    @SuppressLint("SetJavaScriptEnabled")
    fun create(activity: AppCompatActivity, openExternally: (Uri) -> Unit): WebView {
        val loader = WebViewAssetLoader.Builder()
            .setDomain(DOMAIN)
            .addPathHandler("/", SpaAssets(WebViewAssetLoader.AssetsPathHandler(activity)))
            .build()

        return WebView(activity).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Nothing outside `assets/web/` is ever needed, and a WebView that can read the
            // filesystem or a content:// URI is the one way this shell could reach a genome the
            // user did not hand it deliberately.
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            settings.mediaPlaybackRequiresUserGesture = true
            // The app is designed for the viewport it is given; the browser's own zoom would only
            // fight its layout.
            settings.builtInZoomControls = false

            // The bridge the export/download path uses. Its surface is three methods, and the only
            // origin that can ever call them is the one above: `shouldOverrideUrlLoading` sends
            // every other URL to the browser, and the app's CSP allows scripts from 'self' alone.
            addJavascriptInterface(Downloads.Bridge(activity), Downloads.BRIDGE_NAME)

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    if (request.url.host == DOMAIN) return false
                    openExternally(request.url)
                    return true
                }

                override fun onPageFinished(view: WebView, url: String) {
                    Downloads.install(view)
                }
            }

            setDownloadListener { url, _, contentDisposition, mimeType, _ ->
                Downloads.start(this, url, contentDisposition, mimeType)
            }
        }
    }

    /**
     * The asset handler, plus the fallback the web app's routes need. `/people` is a route, not a
     * file; the service worker answers it once it is installed, but the very first navigation of a
     * fresh install reaches this handler instead, and an unhandled path there is a blank screen.
     * Anything that looks like a file (it has an extension) keeps its honest 404.
     */
    private class SpaAssets(private val assets: WebViewAssetLoader.PathHandler) :
        WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            val direct = assets.handle(WEB_DIR + path)
            mimeOverride(path)?.let { direct?.mimeType = it }
            // A missing asset comes back as a response with no body, not as null, so the body is
            // what "found it" has to be read from.
            if (direct?.data != null || path.substringAfterLast('/').contains('.')) return direct
            return assets.handle(WEB_DIR + "index.html")
        }
    }

    /**
     * The types that must be exact, whatever the asset loader guesses from the name: a module
     * script or worker (the PDF reader's `pdf.worker.*.mjs`) served as anything but JavaScript is
     * refused, and WebAssembly only stream-compiles as `application/wasm`. Both failures are silent.
     */
    fun mimeOverride(path: String): String? =
        when (path.substringAfterLast('/').substringAfterLast('.', "").lowercase()) {
            "js", "mjs" -> "text/javascript"
            "wasm" -> "application/wasm"
            else -> null
        }
}
