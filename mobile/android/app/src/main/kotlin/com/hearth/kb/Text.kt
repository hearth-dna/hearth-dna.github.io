package com.hearth.kb

/**
 * Word matching shared by kb search, Ask retrieval and condition suggestions: a port of
 * frontend/src/kb/text.ts. Pure.
 */
private val NON_WORD = Regex("[^\\p{L}\\p{N}*]+")

/** Lower-case words of three or more letters, in any script (Cyrillic health notes too). */
fun tokens(text: String): List<String> = text.lowercase().split(NON_WORD).filter { it.length >= 3 }

/** Whole word, or one word a prefix of the other when it has five letters or more (statin → statins). */
fun tokenMatch(a: String, b: String): Boolean =
    a == b || (a.length >= 5 && b.startsWith(a)) || (b.length >= 5 && a.startsWith(b))
