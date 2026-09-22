package com.hearth.i18n

import android.content.Context
import org.json.JSONObject
import java.util.Locale

/**
 * The web's string catalogue (frontend/src/i18n), copied into assets/i18n/ by `make mobile-i18n`:
 * en.json holds every key, <code>.json each translation. Same rules as the web's translate():
 * missing keys fall back to English, then to the key itself, and `{name}` is interpolated.
 */
class Strings(private val dict: Map<String, String>, private val en: Map<String, String>, val language: String) {

    /** For formatting dates and numbers in the chosen language. */
    val locale: Locale get() = Locale.forLanguageTag(language)

    operator fun invoke(key: String, vararg params: Pair<String, Any>): String =
        interpolate(dict[key] ?: en[key] ?: key, params.toMap())

    companion object {
        /** The phone's first preferred language that ships, matched on the primary subtag. */
        fun load(context: Context): Strings {
            val shipped = context.assets.list("i18n").orEmpty().map { it.removeSuffix(".json") }.toSet()
            val locales = context.resources.configuration.locales
            // Android still reports Indonesian by its legacy ISO 639 code.
            val lang = (0 until locales.size()).map { locales[it].language.replace(Regex("^in$"), "id") }
                .firstOrNull { it in shipped } ?: "en"
            fun read(code: String): Map<String, String> =
                if (code !in shipped) emptyMap()
                else parse(context.assets.open("i18n/$code.json").bufferedReader().use { it.readText() })
            val en = read("en")
            return Strings(if (lang == "en") en else read(lang), en, lang)
        }

        fun parse(json: String): Map<String, String> {
            val o = JSONObject(json)
            return o.keys().asSequence().associateWith { o.optString(it) }
        }

        fun interpolate(msg: String, params: Map<String, Any>): String =
            if (params.isEmpty()) msg
            else Regex("""\{(\w+)\}""").replace(msg) { m -> params[m.groupValues[1]]?.toString() ?: m.value }
    }
}
