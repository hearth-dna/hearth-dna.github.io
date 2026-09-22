package com.hearth.i18n

import org.junit.Assert.assertEquals
import org.junit.Test

class StringsTest {
    private val t = Strings(
        dict = mapOf("healthLog.shownOf" to "{n} von {m}"),
        en = mapOf("healthLog.shownOf" to "{n} of {m}", "common.cancel" to "Cancel"),
        language = "de",
    )

    @Test fun `interpolates, falls back to English, then to the key`() {
        assertEquals("1 von 2", t("healthLog.shownOf", "n" to 1, "m" to 2))
        assertEquals("1 von {m}", t("healthLog.shownOf", "n" to 1))
        assertEquals("Cancel", t("common.cancel"))
        assertEquals("nope.nope", t("nope.nope"))
    }
}
