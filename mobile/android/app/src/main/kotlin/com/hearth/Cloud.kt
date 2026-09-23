package com.hearth

import android.accounts.Account
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import java.io.IOException
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * Signing in to Google Drive and Dropbox for backups (docs/decisions/0009-cloud-drive-buttons.md).
 *
 * This is the shell's only network code, and it touches nothing but credentials: it signs the user
 * in, keeps the long-lived grant, and hands the page short-lived access tokens on request. The
 * backup itself (encrypted when the user set a passphrase) goes from the page through
 * `frontend/src/egress/egress.ts`, so the one place that decides what leaves the device stays one.
 *
 * Google uses Play services' authorization client: no client id or secret in the app, because Google
 * recognises the app by its package name and signing certificate, registered by whoever publishes
 * it. Play services keeps the grant; asking again is silent once the user has agreed. Dropbox uses
 * OAuth with PKCE in the browser, back into the app through its `db-<app key>` scheme; its refresh
 * token is kept in the app's private preferences, beside the database it protects and under the
 * same `allowBackup="false"`.
 *
 * Drive asks for the full `drive` scope, so the user can choose any folder for the backup (a
 * restricted scope: fine for test users, Google verification before a public release); Hearth reads
 * and writes only in the chosen folder. Dropbox keeps to an app folder.
 */
class Cloud(private val activity: ComponentActivity) {
    private val main = Handler(Looper.getMainLooper())
    private val net = Executors.newSingleThreadExecutor()
    private val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val random = SecureRandom()

    /** Access tokens already handed out, so a backup every few seconds does not refresh each time. */
    private val dropboxTokens = mutableMapOf<String, Pair<String, Long>>()

    private var googleWaiting: Done? = null
    private var dropboxWaiting: DropboxPending? = null

    private val googleConsent =
        activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            val done = googleWaiting ?: return@registerForActivityResult
            googleWaiting = null
            try {
                val auth = Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(result.data)
                done(Result.success(signedIn(auth)))
            } catch (e: ApiException) {
                // Backing out of Google's screen is an answer, not an error.
                if (e.statusCode == CommonStatusCodes.CANCELED) done(Result.success(JSONObject.NULL))
                else done(Result.failure(googleError(e)))
            }
        }

    /** The providers this build was set up for; the page offers a button for each. */
    fun providers(): JSONArray = JSONArray().apply {
        if (BuildConfig.GOOGLE_DRIVE) put("google")
        if (BuildConfig.DROPBOX_APP_KEY.isNotEmpty()) put("dropbox")
    }

    // ---- the page's calls; all start on the main thread and answer through `done` -------------

    fun signIn(provider: String, done: Done) = when (provider) {
        "google" -> googleSignIn(done)
        "dropbox" -> dropboxSignIn(done)
        else -> done(Result.failure(IllegalArgumentException("unknown provider")))
    }

    /** A fresh access token, or JSON null when the user has to sign in again. */
    fun token(provider: String, account: String, stale: String?, done: Done) = when (provider) {
        "google" -> googleToken(account, stale, done)
        "dropbox" -> background(done) { dropboxToken(account, stale) ?: JSONObject.NULL }
        else -> done(Result.failure(IllegalArgumentException("unknown provider")))
    }

    fun signOut(provider: String, account: String, done: Done) {
        if (provider != "dropbox") return done(Result.success(JSONObject.NULL))
        background(done) {
            // Revoked at Dropbox too, so the grant is not just forgotten but dead.
            dropboxToken(account, null)?.let { runCatching { post(DROPBOX_REVOKE, "null", bearer = it) } }
            prefs.edit().remove(key(account)).apply()
            dropboxTokens.remove(account)
            JSONObject.NULL
        }
    }

    // ---- Google ------------------------------------------------------------------------------

    private fun googleRequest(account: String?) = AuthorizationRequest.Builder()
        .setRequestedScopes(listOf(Scope(DRIVE), Scope("email")))
        .apply { if (!account.isNullOrEmpty()) setAccount(Account(account, GOOGLE_ACCOUNT_TYPE)) }
        .build()

    private fun googleSignIn(done: Done) {
        if (googleWaiting != null) return done(Result.failure(IllegalStateException("a sign-in is already open")))
        Identity.getAuthorizationClient(activity).authorize(googleRequest(null))
            .addOnSuccessListener { auth ->
                val pending = auth.pendingIntent
                if (auth.hasResolution() && pending != null) {
                    googleWaiting = done
                    googleConsent.launch(IntentSenderRequest.Builder(pending.intentSender).build())
                } else {
                    done(Result.success(signedIn(auth)))
                }
            }
            .addOnFailureListener { done(Result.failure(googleError(it))) }
    }

    private fun googleToken(account: String, stale: String?, done: Done) {
        val ask: () -> Unit = {
            Identity.getAuthorizationClient(activity).authorize(googleRequest(account))
                .addOnSuccessListener { auth ->
                    // A screen would be needed: that is a sign-in, which only a click may start.
                    done(Result.success(if (auth.hasResolution()) JSONObject.NULL else auth.accessToken ?: JSONObject.NULL))
                }
                .addOnFailureListener { done(Result.failure(googleError(it))) }
        }
        if (stale == null) return ask()
        // Drive refused this token; Play services would hand it out again until it is cleared.
        net.execute {
            runCatching { GoogleAuthUtil.clearToken(activity, stale) }
            main.post { ask() }
        }
    }

    private fun signedIn(auth: AuthorizationResult): Any {
        val token = auth.accessToken ?: return JSONObject.NULL
        val account = auth.toGoogleSignInAccount()
        // Often empty: Play services does not always say who signed in. The page then asks Drive
        // (`about`) and keys the account by that address from then on.
        val email = account?.email ?: account?.account?.name ?: ""
        return JSONObject().put("account", email).put("label", email).put("token", token)
    }

    /**
     * Google reports a missing OAuth client either as DEVELOPER_ERROR or, from the consent screen,
     * as an internal error naming UNREGISTERED_ON_API_CONSOLE; both mean the same setup step.
     */
    private fun googleError(e: Exception): Exception =
        if (e is ApiException &&
            (e.statusCode == CommonStatusCodes.DEVELOPER_ERROR || e.message.orEmpty().contains("UNREGISTERED_ON_API_CONSOLE"))
        ) {
            IllegalStateException(
                "Google sign-in is not set up for this build of Hearth (docs/runbook/cloud-backups.md)",
            )
        } else {
            e
        }

    // ---- Dropbox -----------------------------------------------------------------------------

    private val dropboxRedirect get() = "db-${BuildConfig.DROPBOX_APP_KEY}://2/token"

    private fun dropboxSignIn(done: Done) {
        dropboxWaiting?.done?.invoke(Result.success(JSONObject.NULL))
        val verifier = randomToken(48)
        val state = randomToken(16)
        val url = Uri.parse(DROPBOX_AUTHORIZE).buildUpon()
            .appendQueryParameter("client_id", BuildConfig.DROPBOX_APP_KEY)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("code_challenge", challenge(verifier))
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("token_access_type", "offline")
            .appendQueryParameter("redirect_uri", dropboxRedirect)
            .appendQueryParameter("state", state)
            .build()
        dropboxWaiting = DropboxPending(verifier, state, done)
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, url))
        } catch (_: ActivityNotFoundException) {
            dropboxWaiting = null
            done(Result.failure(IllegalStateException("no browser to sign in to Dropbox with")))
        }
    }

    /** The browser came back through the `db-<key>` scheme. False when it was not for us. */
    fun onRedirect(uri: Uri): Boolean {
        if (BuildConfig.DROPBOX_APP_KEY.isEmpty() || uri.scheme != "db-${BuildConfig.DROPBOX_APP_KEY}") return false
        val pending = dropboxWaiting ?: return true
        // Anything can open this scheme; only the answer to our own request, carrying our state,
        // is taken. PKCE means a stolen code is useless without the verifier anyway.
        if (uri.getQueryParameter("state") != pending.state) return true
        dropboxWaiting = null
        val code = uri.getQueryParameter("code")
        if (code == null) {
            // Denied on Dropbox's screen: the same as backing out.
            pending.done(Result.success(JSONObject.NULL))
            return true
        }
        background(pending.done) {
            val tokens = JSONObject(
                post(
                    DROPBOX_TOKEN,
                    form(
                        "code" to code,
                        "grant_type" to "authorization_code",
                        "code_verifier" to pending.verifier,
                        "client_id" to BuildConfig.DROPBOX_APP_KEY,
                        "redirect_uri" to dropboxRedirect,
                    ),
                ),
            )
            val access = tokens.getString("access_token")
            val account = tokens.getString("account_id")
            prefs.edit().putString(key(account), tokens.getString("refresh_token")).apply()
            remember(account, access, tokens.optLong("expires_in", 3600))
            val email = runCatching {
                JSONObject(post(DROPBOX_ACCOUNT, "null", bearer = access)).optString("email")
            }.getOrNull().orEmpty()
            JSONObject().put("account", account).put("label", email.ifEmpty { "Dropbox" }).put("token", access)
        }
        return true
    }

    /** The user came back to the app without finishing the Dropbox sign-in. */
    fun onResume() {
        val pending = dropboxWaiting ?: return
        // onNewIntent (the redirect) runs before onResume, so reaching here with the sign-in still
        // open means the browser was left some other way.
        main.postDelayed({
            if (dropboxWaiting === pending) {
                dropboxWaiting = null
                pending.done(Result.success(JSONObject.NULL))
            }
        }, RESUME_GRACE_MS)
    }

    /** On the network thread. */
    private fun dropboxToken(account: String, stale: String?): String? {
        dropboxTokens[account]?.let { (token, until) ->
            if (token != stale && System.currentTimeMillis() < until) return token
        }
        val refresh = prefs.getString(key(account), null) ?: return null
        val answer = try {
            JSONObject(
                post(
                    DROPBOX_TOKEN,
                    form(
                        "grant_type" to "refresh_token",
                        "refresh_token" to refresh,
                        "client_id" to BuildConfig.DROPBOX_APP_KEY,
                    ),
                ),
            )
        } catch (e: HttpError) {
            // 400 is Dropbox saying the grant is gone (revoked, or the app unlinked): sign in again.
            if (e.code == 400) {
                prefs.edit().remove(key(account)).apply()
                return null
            }
            throw e
        }
        val token = answer.getString("access_token")
        remember(account, token, answer.optLong("expires_in", 3600))
        return token
    }

    private fun remember(account: String, token: String, expiresIn: Long) {
        // A minute early, so a token never expires between being handed out and being used.
        dropboxTokens[account] = token to System.currentTimeMillis() + (expiresIn - 60) * 1000
    }

    // ---- plumbing ----------------------------------------------------------------------------

    private fun background(done: Done, work: () -> Any) = net.execute {
        val result = runCatching(work)
        main.post { done(result) }
    }

    private fun randomToken(bytes: Int) =
        Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(bytes).also(random::nextBytes))

    private class DropboxPending(val verifier: String, val state: String, val done: Done)

    class HttpError(val code: Int, body: String) : IOException("Dropbox answered $code: ${body.take(200)}")

    companion object {
        private const val PREFS = "hearth-cloud"
        private const val DRIVE = "https://www.googleapis.com/auth/drive"
        private const val GOOGLE_ACCOUNT_TYPE = "com.google"
        private const val DROPBOX_AUTHORIZE = "https://www.dropbox.com/oauth2/authorize"
        private const val DROPBOX_TOKEN = "https://api.dropboxapi.com/oauth2/token"
        private const val DROPBOX_ACCOUNT = "https://api.dropboxapi.com/2/users/get_current_account"
        private const val DROPBOX_REVOKE = "https://api.dropboxapi.com/2/auth/token/revoke"
        private const val RESUME_GRACE_MS = 1500L

        private fun key(account: String) = "dropbox:$account"

        /** RFC 7636 S256: base64url of the SHA-256 of the verifier, unpadded. */
        fun challenge(verifier: String): String =
            Base64.getUrlEncoder().withoutPadding()
                .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

        fun form(vararg fields: Pair<String, String>): String =
            fields.joinToString("&") { (k, v) -> "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}" }

        /** A form post (or a JSON one with a bearer token), through [Egress]; the body of a 2xx, else [HttpError]. */
        private fun post(url: String, body: String, bearer: String? = null): String {
            val headers = if (bearer != null) {
                mapOf("Authorization" to "Bearer $bearer", "Content-Type" to "application/json")
            } else {
                mapOf("Content-Type" to "application/x-www-form-urlencoded")
            }
            return try {
                Egress.request("POST", url, headers, body.toByteArray()).decodeToString()
            } catch (e: Egress.HttpError) {
                throw HttpError(e.code, e.message.orEmpty())
            }
        }
    }
}

typealias Done = (Result<Any>) -> Unit
