package com.hearth.ui

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle

private val TAG = Regex("<(\\w+)>(.*?)</\\1>")

/**
 * The web's `rich()` for the few strings that carry markup (`<b>name</b>`, `<r>A</r>`): each tag's
 * text in the style given for it, bold when none is given. Translations keep the same tags (the
 * i18n test checks), so this never shows a raw tag.
 */
fun rich(text: String, styles: Map<String, SpanStyle> = emptyMap(), links: Map<String, String> = emptyMap()): AnnotatedString = buildAnnotatedString {
    var at = 0
    for (m in TAG.findAll(text)) {
        append(text.substring(at, m.range.first))
        val tag = m.groupValues[1]
        val url = links[tag]
        if (url != null) {
            // Opened by the system browser; the link carries nothing from the app.
            withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline)))) { append(m.groupValues[2]) }
        } else {
            withStyle(styles[tag] ?: SpanStyle(fontWeight = FontWeight.Bold)) { append(m.groupValues[2]) }
        }
        at = m.range.last + 1
    }
    append(text.substring(at))
}
