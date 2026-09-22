package com.hearth

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat

/**
 * The whole Android app: one Activity holding one WebView that runs the PWA from
 * `assets/web/`, served over https://appassets.androidplatform.net/ by [HearthWebView].
 *
 * There is no native model layer, and there must not be one — the genome, the pedigree and every
 * analysis live in the web app's SQLite database inside the WebView's own storage
 * (`docs/decisions/0006-native-shells-around-the-pwa.md`). Anything this class can see is a file
 * the user explicitly picked or a file they explicitly asked to save.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var files: Files
    private var pendingFileChooser: ValueCallback<Array<Uri>>? = null

    /**
     * The system file picker, for the `<input type="file">` behind every import dialog. The result
     * goes straight back to the WebView; nothing is copied, read or remembered here.
     */
    private val filePicker =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = pendingFileChooser ?: return@registerForActivityResult
            pendingFileChooser = null
            callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Edge to edge, as Android 15 expects, with transparent bars whose icons follow the
        // light/dark theme. The strips behind them are painted by the container below in the web
        // app's own bar colour, so the status bar reads as part of its top bar and the gesture
        // area as part of its navigation bar.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        window.isNavigationBarContrastEnforced = false

        // The engine, not the OS, is what has to be new enough: the database uses OPFS synchronous
        // access handles, which arrived in Chromium 108. An older WebView would fall back to the
        // in-memory database, and the app would silently lose every import on exit — far worse
        // than refusing to start.
        val engine = webViewVersion()
        if (engine != null && engine < MIN_WEBVIEW_MAJOR) {
            setContentView(TextView(this).apply {
                text = getString(R.string.webview_too_old, engine, MIN_WEBVIEW_MAJOR)
                setTextAppearance(android.R.style.TextAppearance_Material_Body1)
                gravity = Gravity.CENTER
                val pad = (24 * resources.displayMetrics.density).toInt()
                setPadding(pad, pad, pad, pad)
                fitInsets(this, pad)
            })
            return
        }

        web = HearthWebView.create(this, ::openExternally)
        // The backup place (Settings → Backup): a folder or file from the system picker, which is
        // how Google Drive, Dropbox and OneDrive reach other apps. Installed before the first load,
        // since the page only gets the channel on navigations that start after this.
        files = Files(this).also { it.install(web) }
        intent?.data?.let { files.cloud.onRedirect(it) }

        // The web app lays out for the viewport it is given and knows nothing about status bars,
        // gesture handles or the keyboard; without this its top bar sits under the clock. The
        // insets are applied to a plain container rather than to the WebView itself, because a
        // WebView paints its document across its whole bounds and ignores its own padding. The
        // container is painted in the web app's bar colour (colors.xml), which is what shows
        // through the transparent system bars.
        val root = FrameLayout(this).apply {
            setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.bar_background))
            addView(web, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        fitInsets(root, 0)
        setContentView(root)

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                pendingFileChooser?.onReceiveValue(null)
                pendingFileChooser = callback
                return try {
                    filePicker.launch(params.createIntent())
                    true
                } catch (_: ActivityNotFoundException) {
                    pendingFileChooser = null
                    false
                }
            }
        }

        // The web app owns its own history (People, Health, Ask are routes), so Back means "back a
        // page" until there is nowhere left to go, and only then "leave the app".
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState == null) web.loadUrl(HearthWebView.START_URL)
    }

    /** The browser coming back from a Dropbox sign-in (the `db-<app key>` scheme, singleTask). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (::files.isInitialized) intent.data?.let { files.cloud.onRedirect(it) }
    }

    override fun onResume() {
        super.onResume()
        if (::files.isInitialized) files.cloud.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        if (::web.isInitialized && web.restoreState(savedInstanceState) == null) {
            web.loadUrl(HearthWebView.START_URL)
        }
    }

    override fun onDestroy() {
        pendingFileChooser?.onReceiveValue(null)
        pendingFileChooser = null
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    /**
     * Pads [view] clear of the system bars, the display cutout and — since edge to edge turns off
     * `adjustResize` — the keyboard, so a focused field is never hidden behind it.
     */
    private fun fitInsets(view: android.view.View, extra: Int) {
        ViewCompat.setOnApplyWindowInsetsListener(view) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(
                bars.left + extra,
                bars.top + extra,
                bars.right + extra,
                maxOf(bars.bottom, ime.bottom) + extra,
            )
            WindowInsetsCompat.CONSUMED
        }
    }

    /** Links that leave the app's own origin open in the browser, never inside the shell. */
    @SuppressLint("QueryPermissionsNeeded")
    private fun openExternally(url: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url))
        } catch (_: ActivityNotFoundException) {
            // No browser installed: dropping the tap is the whole failure, and it is a fair one.
        }
    }

    private fun webViewVersion(): Int? =
        WebViewCompat.getCurrentWebViewPackage(this)
            ?.versionName
            ?.substringBefore('.')
            ?.toIntOrNull()

    private companion object {
        /** Chromium 108 — the first with `FileSystemSyncAccessHandle`, which the SQLite VFS needs. */
        const val MIN_WEBVIEW_MAJOR = 108
    }
}
