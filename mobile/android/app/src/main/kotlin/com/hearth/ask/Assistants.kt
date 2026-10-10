package com.hearth.ask

import java.net.URLEncoder

/**
 * Chat assistants a context pack can be opened in with the text already in the box: a port of
 * frontend/src/ask/assistants.ts. The text rides in the address (`?q=`), so it reaches the provider:
 * the preview confirms and logs each one like a copy. The address is handed to the system browser
 * (an ACTION_VIEW intent), never opened by the app, so these do not pass through Egress.
 */
data class Assistant(val id: String, val name: String, private val base: String) {
    fun url(text: String): String = base + encodeURIComponent(text)
}

val ASSISTANTS = listOf(
    Assistant("chatgpt", "ChatGPT", "https://chatgpt.com/?q="),
    Assistant("claude", "Claude", "https://claude.ai/new?q="),
    Assistant("mistral", "Mistral", "https://chat.mistral.ai/chat?q="),
    // Google search in AI Mode (udm=50).
    Assistant("google", "Google AI Mode", "https://www.google.com/search?udm=50&q="),
)

/** Longer addresses are cut or refused by browsers and servers; such a pack is copied instead. */
const val MAX_URL = 8000

/** The prefilled address, or null when the text is too long to travel in one. */
fun assistantUrl(a: Assistant, text: String): String? = a.url(text).takeIf { it.length <= MAX_URL }

/** JavaScript's encodeURIComponent: everything but letters, digits and `-_.!~*'()` is %XX of its UTF-8. */
fun encodeURIComponent(s: String): String =
    URLEncoder.encode(s, "UTF-8").replace("+", "%20").replace("%21", "!").replace("%27", "'")
        .replace("%28", "(").replace("%29", ")").replace("%7E", "~")
