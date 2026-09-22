package com.hearth.ui

import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * The Material symbols the screens need that material-icons-core does not carry; path data
 * from the Material icon set. Cheaper than material-icons-extended, which is thousands of icons.
 */
object HearthIcons {
    val FilterList = icon("FilterList", "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z")
    val Sort = icon("Sort", "M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z")
    val ViewAgenda = icon(
        "ViewAgenda",
        "M20 13H3c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h17c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zm0-10H3c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h17c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1z",
    )
    val TableRows = icon("TableRows", "M21 8H3V4h18v4zm0 2H3v4h18v-4zm0 6H3v4h18v-4z")
    val Attach = icon(
        "Attach",
        "M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z",
    )
    val Notes = icon("Notes", "M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z")

    private fun icon(name: String, path: String) = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
        .addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black))
        .build()
}
