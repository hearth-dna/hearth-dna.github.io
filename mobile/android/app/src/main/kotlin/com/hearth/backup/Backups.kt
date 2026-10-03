package com.hearth.backup

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.hearth.Cloud
import com.hearth.Secrets
import com.hearth.data.Repo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import android.content.Intent

/** Where backups go: a picked folder, a picked file, or a cloud drive the user signed in to. */
sealed interface Place {
    val name: String

    data class Folder(val ref: String, override val name: String) : Place
    data class File(val ref: String, override val name: String) : Place
    data class Cloud(
        val provider: String,
        val account: String,
        val label: String,
        override val name: String,
        /** The Drive folder chosen; null means a `Hearth` folder in My Drive (Dropbox: its app folder). */
        val folderId: String? = null,
    ) : Place
}

/** The place and what this phone knows about it (folder.ts `Saved`). */
data class Saved(
    val place: Place,
    val lastSeen: Seen? = null,
    /** The user chose to store without a passphrase. */
    val plain: Boolean = false,
    val auto: Boolean = true,
    val lastAt: String? = null,
    /** Attached documents the place held after the last copy. */
    val mirrored: Int = 0,
)

/** What the Settings card and the sync button show (scheduler.ts `Status`). */
sealed interface Status {
    data object None : Status
    data class Reconnect(val name: String) : Status
    data class NeedsPassphrase(val name: String) : Status
    data class Ready(val name: String, val pending: Boolean, val dirty: Boolean, val lastAt: String?, val attachmentsPending: Int, val attachmentsMissing: Int) : Status
    data class Writing(val name: String, val step: String) : Status
    data class Error(val name: String, val message: String) : Status
}

/**
 * The phone's backup (backup/scheduler.ts): the remembered place, the passphrase kept in the
 * Keystore, a debounced backup after every change, and the one sync rule there is: **newer data in
 * the place is loaded first**, at start, whenever the app comes back to the foreground, and before
 * every backup. Loading is a union by id, so nothing is lost; a deletion does not travel.
 */
class Backups(private val context: Context, private val repo: Repo, private val cloud: Cloud?) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val secrets = Secrets(context)
    private val main = Handler(Looper.getMainLooper())
    private var timer: Job? = null
    private val _status = MutableStateFlow<Status>(Status.None)
    val status: StateFlow<Status> = _status

    /** Bumped after data from the place was loaded, so the screens reload. */
    val pulled = MutableStateFlow(0)

    var saved: Saved? = load()
        private set

    init {
        repo.onChange = { request() }
        refreshSoon()
    }

    private val dir: Dir
        get() = when (val p = saved?.place ?: error("no backup place chosen")) {
            is Place.Folder -> SafDir(context.contentResolver, Uri.parse(p.ref), p.name)
            is Place.File -> SafFile(context.contentResolver, Uri.parse(p.ref), p.name)
            is Place.Cloud -> if (p.provider == "google") googleDrive(tokens(p), p.name, p.folderId) else dropbox(tokens(p), p.name)
        }

    val plain get() = saved?.plain ?: false
    val auto get() = saved?.auto ?: true
    val single get() = saved?.place is Place.File

    fun passphrase(): String = secrets.get(PASS_KEY) ?: ""

    fun setPassphrase(p: String) {
        if (p.isEmpty()) secrets.delete(PASS_KEY) else secrets.set(PASS_KEY, p)
        refreshSoon()
    }

    fun setPlain(plain: Boolean) = update { it.copy(plain = plain) }.also { refreshSoon() }

    fun setAuto(auto: Boolean) {
        update { it.copy(auto = auto) }
        if (auto) request() else timer?.cancel()
        refreshSoon()
    }

    /** A new place replaces the old one; its grant (or sign-in) is released unless it is the same. */
    fun choose(place: Place) {
        saved?.place?.let { if (it != place) release(it) }
        saved = Saved(place)
        store()
        refreshSoon()
    }

    /** Forgets the place and, if asked, deletes the snapshots and copies in it. Returns (snapshots, files). */
    suspend fun forget(deleteFiles: Boolean): Pair<Int, Int> = lock.withLock {
        var n = 0
        var files = 0
        if (saved != null && deleteFiles) runCatching {
            val d = dir
            n = deleteSnapshots(d)
            files = removeDir(d, ATTACHMENTS_DIR)
            n += removeDir(d, GENOMES_DIR)
        }
        saved?.place?.let(::release)
        saved = null
        store()
        secrets.delete(PASS_KEY)
        _status.value = Status.None
        n to files
    }

    private fun release(place: Place) {
        when (place) {
            is Place.Folder, is Place.File -> runCatching {
                context.contentResolver.releasePersistableUriPermission(Uri.parse(if (place is Place.Folder) place.ref else (place as Place.File).ref), READ_WRITE)
            }
            is Place.Cloud -> main.post { cloud?.signOut(place.provider, place.account) {} }
        }
    }

    // ---- the schedule -------------------------------------------------------------------------

    /** A change happened: with automatic sync on, a backup follows a quiet period (one per burst of writes). */
    fun request() {
        val s = saved ?: return
        if (!s.auto) {
            (_status.value as? Status.Ready)?.let { _status.value = it.copy(dirty = true) }
            return
        }
        timer?.cancel()
        timer = scope.launch {
            delay(DEBOUNCE_MS)
            timer = null
            backupNow()
        }
        (_status.value as? Status.Ready)?.let { _status.value = it.copy(pending = true, dirty = true) }
    }

    /** Back in the foreground, or asked by a screen: re-read the place and pull anything newer. */
    fun refreshSoon() {
        scope.launch { refresh() }
    }

    private fun device() = repo.getMeta("device") ?: ""
    private fun generation() = repo.getMeta("generation")?.toLongOrNull() ?: 0

    private fun dirty(): Boolean {
        val seen = saved?.lastSeen ?: return true
        return seen.device != device() || generation() > seen.generation
    }

    private fun granted(p: Place): Boolean = when (p) {
        is Place.Folder -> hasGrant(p.ref)
        is Place.File -> hasGrant(p.ref)
        is Place.Cloud -> runCatching { tokens(p)(false); true }.getOrElse { it !is SignInNeeded }
    }

    private fun hasGrant(ref: String) = context.contentResolver.persistedUriPermissions.any { it.uri.toString() == ref && it.isReadPermission && it.isWritePermission }

    /** Re-derives the status from the place, and loads a newer snapshot when there is one. */
    suspend fun refresh() {
        val s = saved ?: run { _status.value = Status.None; return }
        val name = s.place.name
        if (!granted(s.place)) { _status.value = Status.Reconnect(name); return }
        val current = try {
            currentHeader(dir)
        } catch (e: Exception) {
            _status.value = Status.Error(name, e.message ?: e.javaClass.simpleName)
            return
        }
        // Follow the place: with no passphrase here and an unencrypted backup there, keep writing
        // it unencrypted rather than stop syncing.
        if (current != null && !current.optBoolean("encrypted") && passphrase().isEmpty() && !s.plain) update { it.copy(plain = true) }
        val newer = hasNewer(current, device(), saved?.lastSeen)
        if (newer && current?.optBoolean("encrypted") == true && passphrase().isEmpty()) { _status.value = Status.NeedsPassphrase(name); return }
        if (newer) { sync(); return }
        if (!plain && passphrase().isEmpty()) { _status.value = Status.NeedsPassphrase(name); return }
        val isDirty = dirty()
        val blobs = repo.sql.query("SELECT COUNT(DISTINCT sha256) AS n FROM attachment").first()["n"].let { (it as Number).toInt() }
        val have = repo.blobs.list().toSet()
        val missing = repo.sql.query("SELECT DISTINCT sha256 FROM attachment").count { Repo.attachmentBlobName(it["sha256"] as String) !in have }
        _status.value = Status.Ready(name, timer != null, isDirty, saved?.lastAt, if (single) 0 else maxOf(0, blobs - (saved?.mirrored ?: 0)), missing)
        // Changes made while the place was unreachable go out without waiting for the next edit.
        if (isDirty && auto && timer == null && !lock.isLocked) request()
    }

    /** Brings in whatever the place has that this phone has not seen, then writes this phone's state back. */
    suspend fun sync() {
        timer?.cancel()
        if (pullIfNewer() == PullOutcome.FAILED) return
        backupNow()
    }

    private enum class PullOutcome { PULLED, CURRENT, FAILED }

    private suspend fun pullIfNewer(): PullOutcome = lock.withLock {
        val s = saved ?: return PullOutcome.CURRENT
        try {
            if (!hasNewer(currentHeader(dir), device(), s.lastSeen)) return PullOutcome.CURRENT
            _status.value = Status.Writing(s.place.name, "loading")
            pull()
            PullOutcome.PULLED
        } catch (e: Exception) {
            _status.value = Status.Error(s.place.name, message(e))
            PullOutcome.FAILED
        }
    }

    /** Writes a snapshot now, after loading anything newer the place holds. */
    suspend fun backupNow() {
        val s = saved ?: return
        timer?.cancel()
        timer = null
        val name = s.place.name
        if (!granted(s.place)) { _status.value = Status.Reconnect(name); return }
        if (pullIfNewer() == PullOutcome.FAILED) return
        val pass = passphrase()
        if (!plain && pass.isEmpty()) { _status.value = Status.NeedsPassphrase(name); return }
        // Nothing of ours the place lacks (a pull just brought it level): no write, no new rotation.
        if (saved?.lastSeen != null && !dirty()) return refresh()
        lock.withLock {
            _status.value = Status.Writing(name, "building")
            try {
                val d = dir
                val key = if (plain) null else pass
                val bytes = if (d.single) {
                    snapshotBytes(repo, APP_VERSION, key)
                } else {
                    // Genomes beside the snapshot, written once; after an edit only the journal goes.
                    val snap = buildSnapshot(repo, APP_VERSION, embed = false)
                    _status.value = Status.Writing(name, "writing")
                    mirrorGenomes(d, repo, snap.files, key)
                    serialiseContainer(snap.container, key)
                }
                _status.value = Status.Writing(name, "writing")
                writeSnapshot(d, bytes, APP_URL)
                update { it.copy(lastSeen = Seen(device(), generation()), lastAt = Repo.now()) }
                _status.value = Status.Writing(name, "attachments")
                // Not fatal: the snapshot is written, and a refused file must not cost the user it.
                if (!d.single) runCatching { mirrorAttachments(d, repo, key) }.onSuccess { n -> update { it.copy(mirrored = n) } }
            } catch (e: Exception) {
                _status.value = Status.Error(name, message(e))
                return
            }
        }
        refresh()
    }

    /** Loads the place's snapshot now (union by id); for "Load from backup". */
    suspend fun loadFromPlace(): RestoreResult = lock.withLock { pull() }.also { refresh() }

    /** Fetches documents this phone has rows for but not bytes. */
    suspend fun pullDocuments(): Pair<Int, Int> = lock.withLock { pullAttachments(dir, repo, if (plain) null else passphrase().ifEmpty { null }) }.also { refresh() }

    private fun pull(): RestoreResult {
        val d = dir
        val bytes = d.read(SNAPSHOT) ?: error("no $SNAPSHOT in ${d.name}")
        val pass = passphrase().ifEmpty { null }
        val r = restoreBytes(repo, bytes, pass, loadGenome = genomeLoader(d, pass))
        pullAttachments(d, repo, pass)
        (readHeaderPrefix(bytes) ?: runCatching { openContainer(bytes, pass).header }.getOrNull())?.let { h ->
            update { it.copy(lastSeen = Seen(h.optString("device"), h.optLong("generation"))) }
        }
        pulled.value++
        return r
    }

    private fun message(e: Exception) = (e as? BackupException)?.key ?: e.message ?: e.javaClass.simpleName

    // ---- tokens, from Cloud.kt's callbacks ------------------------------------------------------

    private val cached = HashMap<String, String>()

    /** Access tokens for a cloud place, asked of [Cloud] on the main thread and awaited here. */
    private fun tokens(p: Place.Cloud): TokenSource = { fresh ->
        val key = "${p.provider}:${p.account}"
        val have = cached[key]
        if (!fresh && have != null) have
        else {
            val c = cloud ?: throw SignInNeeded(p.provider)
            val latch = CountDownLatch(1)
            var result: Result<Any>? = null
            main.post { c.token(p.provider, p.account, if (fresh) have else null) { result = it; latch.countDown() } }
            if (!latch.await(60, TimeUnit.SECONDS)) error("signing in to ${p.name} took too long")
            val token = result!!.getOrThrow() as? String ?: throw SignInNeeded(p.provider)
            cached[key] = token
            token
        }
    }

    // ---- remembered place -----------------------------------------------------------------------

    private fun update(change: (Saved) -> Saved) {
        saved = saved?.let(change)
        store()
    }

    private fun store() {
        val s = saved ?: return prefs.edit().remove(KEY).apply()
        val place = when (val p = s.place) {
            is Place.Folder -> JSONObject().put("kind", "folder").put("ref", p.ref).put("name", p.name)
            is Place.File -> JSONObject().put("kind", "file").put("ref", p.ref).put("name", p.name)
            is Place.Cloud -> JSONObject().put("kind", "cloud").put("provider", p.provider).put("account", p.account).put("label", p.label).put("name", p.name).put("folderId", p.folderId)
        }
        val o = JSONObject().put("place", place).put("plain", s.plain).put("auto", s.auto).put("lastAt", s.lastAt).put("mirrored", s.mirrored)
        s.lastSeen?.let { o.put("lastSeen", JSONObject().put("device", it.device).put("generation", it.generation)) }
        prefs.edit().putString(KEY, o.toString()).apply()
    }

    private fun load(): Saved? = runCatching {
        val o = JSONObject(prefs.getString(KEY, null) ?: return null)
        val p = o.getJSONObject("place")
        val place = when (p.getString("kind")) {
            "folder" -> Place.Folder(p.getString("ref"), p.getString("name"))
            "file" -> Place.File(p.getString("ref"), p.getString("name"))
            else -> Place.Cloud(p.getString("provider"), p.getString("account"), p.optString("label"), p.getString("name"), p.optString("folderId").ifEmpty { null })
        }
        Saved(
            place,
            o.optJSONObject("lastSeen")?.let { Seen(it.getString("device"), it.getLong("generation")) },
            o.optBoolean("plain"),
            o.optBoolean("auto", true),
            o.optString("lastAt").ifEmpty { null },
            o.optInt("mirrored"),
        )
    }.getOrNull()

    companion object {
        private const val PREFS = "hearth.backup"
        private const val KEY = "default"
        /** The same name the web shell used, so a passphrase kept there is found here. */
        const val PASS_KEY = "hearth:default:backup-pass"
        private const val DEBOUNCE_MS = 5_000L
        const val APP_VERSION = "native"
        /** Where the README tells a reader to restore from; a placeholder, the real one is the publisher's. */
        const val APP_URL = "the Hearth app"
        const val READ_WRITE = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    }
}
