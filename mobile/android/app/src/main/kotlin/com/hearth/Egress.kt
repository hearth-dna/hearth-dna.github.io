package com.hearth

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * The only code in the app that opens a network connection (ADR 0010, as egress.ts is on the web;
 * EgressTest fails the build if anything else does). There is no server of ours: the destinations
 * are the model provider the user brings a key for and the cloud drive the user signs in to for
 * backups, and a request to any other host is refused before a socket is opened.
 */
object Egress {
    /** Every host the app may contact. Kept in step with the web's CSP and CLOUD_HOSTS. */
    val HOSTS = setOf(
        "generativelanguage.googleapis.com", // reading a document with the user's Gemini key
        "www.googleapis.com", // Google Drive backups
        "api.dropboxapi.com", // Dropbox backups and sign-in
        "content.dropboxapi.com",
    )

    const val GEMINI_DEFAULT_MODEL = "gemini-3.8-flash"
    private const val GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    class HttpError(val code: Int, body: String) : IOException("the provider answered $code: ${body.take(200)}")

    /** One HTTPS request to an allowed host; the body of a 2xx, else [HttpError]. Call off the main thread. */
    fun request(method: String, url: String, headers: Map<String, String> = emptyMap(), body: ByteArray? = null): ByteArray {
        val u = URL(url)
        require(u.protocol == "https" && u.host in HOSTS) { "refusing to contact ${u.host}" }
        val conn = u.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 120_000
            conn.instanceFollowRedirects = false
            for ((k, v) in headers) conn.setRequestProperty(k, v)
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body) }
            }
            val code = conn.responseCode
            val bytes = (if (code in 200..299) conn.inputStream else conn.errorStream)?.use { it.readBytes() } ?: ByteArray(0)
            if (code !in 200..299) throw HttpError(code, bytes.decodeToString())
            return bytes
        } finally {
            conn.disconnect()
        }
    }

    /** One page of a document: its type and bytes. */
    class DocumentPart(val mime: String, val bytes: ByteArray)

    /**
     * Sends the pages of one medical document straight to Gemini with the user's own key and returns
     * the model's JSON text and the model that answered (egress.ts `readDocumentWithGemini`).
     * [confirmedAt] is set by the confirmation the user tapped; nothing is sent without it.
     */
    fun readDocumentWithGemini(key: String, model: String?, parts: List<DocumentPart>, prompt: String, schema: JSONObject, confirmedAt: String?): Pair<String, String> {
        require(!confirmedAt.isNullOrEmpty()) { "refusing to send without an explicit confirmation" }
        require(key.isNotEmpty()) { "an API key is required for a direct provider call" }
        val m = model?.ifEmpty { null } ?: GEMINI_DEFAULT_MODEL
        val inline = JSONArray()
        for (p in parts) inline.put(JSONObject().put("inlineData", JSONObject().put("mimeType", p.mime).put("data", java.util.Base64.getEncoder().encodeToString(p.bytes))))
        inline.put(JSONObject().put("text", prompt))
        val request = JSONObject()
            .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", inline)))
            .put("generationConfig", JSONObject().put("temperature", 0).put("responseMimeType", "application/json").put("responseSchema", schema))
        val answer = JSONObject(
            request(
                "POST",
                "$GEMINI_URL/${java.net.URLEncoder.encode(m, "UTF-8")}:generateContent",
                mapOf("content-type" to "application/json", "x-goog-api-key" to key),
                request.toString().toByteArray(),
            ).decodeToString(),
        )
        val out = answer.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
        val text = buildString { for (i in 0 until (out?.length() ?: 0)) append(out!!.optJSONObject(i)?.optString("text").orEmpty()) }
        if (text.isEmpty()) throw IOException("provider returned no text")
        return text to answer.optString("modelVersion", m).ifEmpty { m }
    }
}
