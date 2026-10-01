package com.hearth.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.hearth.data.HealthKind

/**
 * Material 3 with the web app's palette (frontend/src/styles.css `:root`): the deep green accent,
 * the warm paper background, the mint indicator. Fixed rather than dynamic colour so the app looks
 * like Hearth on every phone.
 */
private val Light = lightColorScheme(
    primary = Color(0xFF1F4D3A),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD4E8DC),
    onPrimaryContainer = Color(0xFF0F2A1F),
    secondaryContainer = Color(0xFFD4E8DC),
    onSecondaryContainer = Color(0xFF0F2A1F),
    background = Color(0xFFFAF8F4),
    onBackground = Color(0xFF1D1D1B),
    surface = Color(0xFFFAF8F4),
    onSurface = Color(0xFF1D1D1B),
    surfaceVariant = Color(0xFFEFEBE3),
    onSurfaceVariant = Color(0xFF6B6A66),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFF4F1EA),
    surfaceContainerHigh = Color(0xFFEFEBE3),
    surfaceContainerHighest = Color(0xFFE9E5DC),
    outline = Color(0xFFB9B4A9),
    outlineVariant = Color(0xFFE4E0D8),
    error = Color(0xFFA8231F),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF7FC8A3),
    onPrimary = Color(0xFF0F1F18),
    primaryContainer = Color(0xFF2C4A3B),
    onPrimaryContainer = Color(0xFFD4E8DC),
    secondaryContainer = Color(0xFF2C4A3B),
    onSecondaryContainer = Color(0xFFD4E8DC),
    background = Color(0xFF15171A),
    onBackground = Color(0xFFEBE8E1),
    surface = Color(0xFF15171A),
    onSurface = Color(0xFFEBE8E1),
    surfaceVariant = Color(0xFF2E3237),
    onSurfaceVariant = Color(0xFFA09D95),
    surfaceContainerLowest = Color(0xFF101214),
    surfaceContainerLow = Color(0xFF1E2125),
    surfaceContainer = Color(0xFF22262A),
    surfaceContainerHigh = Color(0xFF2A2E33),
    surfaceContainerHighest = Color(0xFF33373D),
    outline = Color(0xFF6F6C66),
    outlineVariant = Color(0xFF2E3237),
    error = Color(0xFFFF8A80),
)

@Composable
fun HearthTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}

/** One colour per kind of entry, as on the web (`.kind-*`), with a lighter set for dark mode. */
@Composable
fun kindColor(kind: HealthKind): Color {
    val dark = isSystemInDarkTheme()
    return when (kind) {
        HealthKind.SYMPTOM -> if (dark) Color(0xFFE58A78) else Color(0xFFB4432F)
        HealthKind.MEASUREMENT -> if (dark) Color(0xFF7FB2E5) else Color(0xFF2F6FA8)
        HealthKind.LAB -> if (dark) Color(0xFFB99BE0) else Color(0xFF7A4FB0)
        HealthKind.IMAGING -> if (dark) Color(0xFF6FC9C2) else Color(0xFF1F7F7A)
        HealthKind.DIAGNOSIS -> if (dark) Color(0xFFE0B35A) else Color(0xFFA86A00)
        HealthKind.MEDICATION -> if (dark) Color(0xFF85C98F) else Color(0xFF2F7D3A)
        HealthKind.LETTER -> if (dark) Color(0xFFC9B08C) else Color(0xFF7A6446)
        HealthKind.OTHER -> MaterialTheme.colorScheme.onSurfaceVariant
    }
}

/** Severity 4 and up in amber, 7 and up in red, as on the web (`.mag`). */
@Composable
fun severityColor(n: Int): Color = when {
    n >= 7 -> MaterialTheme.colorScheme.error
    n >= 4 -> if (isSystemInDarkTheme()) Color(0xFFE0B35A) else Color(0xFF9A4B00)
    else -> MaterialTheme.colorScheme.onSurface
}
