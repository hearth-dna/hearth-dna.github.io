package com.hearth.backup

import com.hearth.Egress
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Google Drive and Dropbox as a backup place (backup/cloud.ts, ADR 0009), over each provider's REST
 * API and through [Egress] only. [TokenSource] hands out short-lived access tokens; `fresh` asks
 * past a cached one the provider refused.
 */
typealias TokenSource = (fresh: Boolean) -> String

/** The provider refused the grant: the user has to sign in again. */
class SignInNeeded(provider: String) : Exception("${if (provider == "google") "Google Drive" else "Dropbox"} needs you to sign in again")

private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

/** One authorised call, retried once with a fresh token when the cached one has expired. */
private fun send(provider: String, token: TokenSource, method: String, url: String, headers: Map<String, String> = emptyMap(), body: ByteArray? = null): Egress.Response {
    var r = Egress.call(method, url, headers + ("Authorization" to "Bearer ${token(false)}"), body)
    if (r.code == 401) r = Egress.call(method, url, headers + ("Authorization" to "Bearer ${token(true)}"), body)
    if (r.code == 401) throw SignInNeeded(provider)
    return r
}

private fun Egress.Response.ok(what: String): Egress.Response {
    if (!ok) error("$what failed ($code)")
    return this
}

// ---- Google Drive ---------------------------------------------------------------------------

private const val DRIVE = "https://www.googleapis.com/drive/v3/files"
private const val DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
private const val DRIVE_ABOUT = "https://www.googleapis.com/drive/v3/about"
private const val FOLDER = "application/vnd.google-apps.folder"
private const val ROOT_NAME = "Hearth"

/** Drive's query language quotes with single quotes and escapes with a backslash. */
private fun quote(s: String) = "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"

data class DriveFolder(val id: String, val name: String, val parents: List<String> = emptyList())

private fun driveCall(token: TokenSource) = { method: String, url: String, headers: Map<String, String>, body: ByteArray? -> send("google", token, method, url, headers, body) }

private fun driveQuery(token: TokenSource, q: String, fields: String, extra: String = ""): List<DriveFolder> {
    val call = driveCall(token)
    val out = mutableListOf<DriveFolder>()
    var page = ""
    do {
        val url = "$DRIVE?q=${enc(q)}&fields=${enc("nextPageToken,files($fields)")}&pageSize=1000&spaces=drive$extra" + (if (page.isNotEmpty()) "&pageToken=$page" else "")
        val body = JSONObject(call("GET", url, emptyMap(), null).ok("listing Google Drive").text())
        val files = body.optJSONArray("files") ?: JSONArray()
        for (i in 0 until files.length()) files.getJSONObject(i).let { f ->
            out += DriveFolder(f.getString("id"), f.optString("name"), f.optJSONArray("parents")?.let { p -> (0 until p.length()).map(p::getString) } ?: emptyList())
        }
        page = body.optString("nextPageToken")
    } while (page.isNotEmpty())
    return out
}

private fun makeFolder(token: TokenSource, name: String, parent: String): String =
    JSONObject(
        driveCall(token)(
            "POST", "$DRIVE?fields=id", mapOf("content-type" to "application/json"),
            JSONObject().put("name", name).put("mimeType", FOLDER).put("parents", JSONArray().put(parent)).toString().toByteArray(),
        ).ok("creating a Google Drive folder").text(),
    ).getString("id")

/** Who signed in, from Drive itself: Play services does not always say. */
fun driveAccount(token: TokenSource): String =
    JSONObject(driveCall(token)("GET", "$DRIVE_ABOUT?fields=${enc("user(emailAddress)")}", emptyMap(), null).ok("asking Google Drive who signed in").text())
        .optJSONObject("user")?.optString("emailAddress").orEmpty()

/** What the Drive folder chooser needs: folders in one, by name, and those that hold a backup. */
class DriveFolders(private val token: TokenSource) {
    private val onlyFolders = "mimeType = '$FOLDER' and trashed = false"
    private val known = HashMap<String, DriveFolder>()

    fun list(parent: String) = driveQuery(token, "${quote(parent)} in parents and $onlyFolders", "id,name,parents", "&orderBy=name").onEach { known[it.id] = it }

    fun search(text: String) = driveQuery(token, "name contains ${quote(text)} and $onlyFolders", "id,name,parents", "&orderBy=name").take(50).onEach { known[it.id] = it }

    /** Folders that already hold [snapshot]: the backup made on another device is one tap away. */
    fun withBackup(snapshot: String = SNAPSHOT): List<DriveFolder> =
        driveQuery(token, "name = ${quote(snapshot)} and trashed = false", "id,name,parents").flatMap { it.parents }.distinct().mapNotNull(::node)

    private fun node(id: String): DriveFolder? = known[id] ?: runCatching {
        val r = driveCall(token)("GET", "$DRIVE/$id?fields=${enc("id,name,parents")}", emptyMap(), null)
        if (!r.ok) return null
        val f = JSONObject(r.text())
        DriveFolder(f.getString("id"), f.optString("name"), f.optJSONArray("parents")?.let { p -> (0 until p.length()).map(p::getString) } ?: emptyList()).also { known[id] = it }
    }.getOrNull()

    /** "My Drive › Backups › Hearth" for display: the folders above [id], the folder last. */
    fun path(id: String): String {
        val top = node("root")?.id ?: "root"
        val out = mutableListOf<String>()
        var at = node(id)
        while (at != null && out.size < 30) {
            out.add(0, at.name)
            val up = at.parents.firstOrNull()
            if (up == null || up == top) break
            at = node(up)
        }
        return out.joinToString(" › ")
    }

    fun create(parent: String, name: String) = DriveFolder(makeFolder(token, name, parent), name, listOf(parent))
}

/** Backups in the Drive folder [folderId], or in a `Hearth` folder in My Drive when none was chosen. */
fun googleDrive(token: TokenSource, label: String, folderId: String?): Dir {
    val call = driveCall(token)
    fun children(parent: String): List<Triple<String, String, String>> {
        val out = mutableListOf<Triple<String, String, String>>()
        var page = ""
        do {
            val url = "$DRIVE?q=${enc("${quote(parent)} in parents and trashed = false")}&fields=${enc("nextPageToken,files(id,name,mimeType)")}&pageSize=1000&spaces=drive" +
                (if (page.isNotEmpty()) "&pageToken=$page" else "")
            val body = JSONObject(call("GET", url, emptyMap(), null).ok("listing Google Drive").text())
            val files = body.optJSONArray("files") ?: JSONArray()
            for (i in 0 until files.length()) files.getJSONObject(i).let { out += Triple(it.getString("name"), it.getString("id"), it.optString("mimeType")) }
            page = body.optString("nextPageToken")
        } while (page.isNotEmpty())
        return out
    }

    /** Two-step resumable upload: no size ceiling, unlike the 5 MB simple and multipart ones. */
    fun upload(existing: String?, name: String, parent: String, bytes: ByteArray) {
        val start = call(
            if (existing != null) "PATCH" else "POST",
            "$DRIVE_UPLOAD${if (existing != null) "/$existing" else ""}?uploadType=resumable",
            mapOf("content-type" to "application/json; charset=UTF-8"),
            (if (existing != null) JSONObject() else JSONObject().put("name", name).put("parents", JSONArray().put(parent))).toString().toByteArray(),
        ).ok("starting the upload of $name")
        val session = start.headers["location"] ?: error("Google Drive did not return an upload address")
        call("PUT", session, emptyMap(), bytes).ok("uploading $name")
    }

    fun dir(name: String, id: () -> String): Dir = object : Dir {
        private var known: Map<String, Triple<String, String, String>>? = null
        private fun entries() = children(id()).associateBy { it.first }.also { known = it }
        private fun find(child: String) = known?.get(child) ?: entries()[child]

        override val name = name
        override val single = false
        override val versioned = true
        override fun names() = entries().keys.toList()
        override fun read(name: String): ByteArray? {
            val e = find(name)?.takeIf { it.third != FOLDER } ?: return null
            val r = call("GET", "$DRIVE/${e.second}?alt=media", emptyMap(), null)
            return if (r.code == 404) null else r.ok("reading $name").body
        }
        override fun readHead(name: String, bytes: Int): ByteArray? {
            val e = find(name)?.takeIf { it.third != FOLDER } ?: return null
            val r = call("GET", "$DRIVE/${e.second}?alt=media", mapOf("range" to "bytes=0-${bytes - 1}"), null)
            return if (r.code == 404) null else r.ok("reading $name").body
        }
        override fun write(name: String, bytes: ByteArray) {
            val e = find(name)
            upload(e?.takeIf { it.third != FOLDER }?.second, name, id(), bytes)
            known = null
        }
        override fun remove(name: String) {
            val e = find(name) ?: return
            // To the bin, not gone: Drive keeps it for 30 days, the undo the user expects.
            call("PATCH", "$DRIVE/${e.second}", mapOf("content-type" to "application/json"), """{"trashed":true}""".toByteArray()).ok("deleting $name")
            known = null
        }
        override fun subdir(name: String, create: Boolean): Dir? {
            val e = find(name)
            if (e?.third == FOLDER) return dir(name) { e.second }
            if (e != null || !create) return null
            val made = makeFolder(token, name, id())
            known = null
            return dir(name) { made }
        }
    }

    if (folderId != null) return dir(label) { folderId }
    // The top folder is found (or made) on first use, then remembered.
    var root: String? = null
    return dir(label) {
        root ?: (children("root").firstOrNull { it.first == ROOT_NAME && it.third == FOLDER }?.second ?: makeFolder(token, ROOT_NAME, "root")).also { root = it }
    }
}

// ---- Dropbox --------------------------------------------------------------------------------

private const val DBX_API = "https://api.dropboxapi.com/2"
private const val DBX_CONTENT = "https://content.dropboxapi.com/2"

/** Dropbox wants its JSON argument header in ASCII, anything else escaped. */
private fun dropboxArg(arg: JSONObject) = buildString {
    for (c in arg.toString()) if (c.code in 0x7f..0xffff) append("\\u%04x".format(c.code)) else append(c)
}

/** The app folder (`Apps/<app name>`): Dropbox's root for this app is the empty path. */
fun dropbox(token: TokenSource, label: String): Dir {
    fun call(method: String, url: String, headers: Map<String, String> = emptyMap(), body: ByteArray? = null) = send("dropbox", token, method, url, headers, body)
    fun rpc(endpoint: String, arg: JSONObject) = call("POST", "$DBX_API/$endpoint", mapOf("content-type" to "application/json"), arg.toString().toByteArray())
    /** 409 is Dropbox's "the path is not there" (and every other request-level refusal). */
    fun Egress.Response.missing() = code == 409

    fun dir(name: String, path: String): Dir = object : Dir {
        private fun at(child: String) = "$path/$child"
        override val name = name
        override val single = false
        override val versioned = true
        override fun names(): List<String> {
            var r = rpc("files/list_folder", JSONObject().put("path", path).put("limit", 2000))
            if (r.missing()) return emptyList()
            val out = mutableListOf<String>()
            while (true) {
                val body = JSONObject(r.ok("listing Dropbox").text())
                val entries = body.getJSONArray("entries")
                for (i in 0 until entries.length()) out += entries.getJSONObject(i).getString("name")
                if (!body.optBoolean("has_more")) return out
                r = rpc("files/list_folder/continue", JSONObject().put("cursor", body.getString("cursor")))
            }
        }
        override fun read(name: String): ByteArray? {
            val r = call("POST", "$DBX_CONTENT/files/download", mapOf("dropbox-api-arg" to dropboxArg(JSONObject().put("path", at(name)))))
            return if (r.missing()) null else r.ok("reading $name").body
        }
        override fun readHead(name: String, bytes: Int): ByteArray? {
            val r = call("POST", "$DBX_CONTENT/files/download", mapOf("dropbox-api-arg" to dropboxArg(JSONObject().put("path", at(name))), "range" to "bytes=0-${bytes - 1}"))
            return if (r.missing()) null else r.ok("reading $name").body
        }
        override fun write(name: String, bytes: ByteArray) {
            call(
                "POST", "$DBX_CONTENT/files/upload",
                mapOf("content-type" to "application/octet-stream", "dropbox-api-arg" to dropboxArg(JSONObject().put("path", at(name)).put("mode", "overwrite").put("mute", true))),
                bytes,
            ).ok("uploading $name")
        }
        override fun remove(name: String) {
            val r = rpc("files/delete_v2", JSONObject().put("path", at(name)))
            if (!r.missing()) r.ok("deleting $name")
        }
        override fun subdir(name: String, create: Boolean): Dir? {
            val r = rpc("files/get_metadata", JSONObject().put("path", at(name)))
            if (r.ok) return if (JSONObject(r.text()).optString(".tag") == "folder") dir(name, at(name)) else null
            if (!r.missing()) r.ok("opening $name")
            if (!create) return null
            rpc("files/create_folder_v2", JSONObject().put("path", at(name)).put("autorename", false)).ok("creating $name")
            return dir(name, at(name))
        }
    }
    return dir(label, "")
}
