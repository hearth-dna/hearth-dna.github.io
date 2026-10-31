package com.hearth.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import com.hearth.health.isMilkTooth
import com.hearth.health.teethText
import com.hearth.health.toggleTooth
import com.hearth.health.toothAt

/** How one tooth is drawn: its fill, its number's colour, and whether it is outlined. */
private class ToothLook(val fill: Color, val text: Color, val outlined: Boolean)

/**
 * Both jaws, the person's right on the viewer's left, permanent or milk teeth (ToothChart.tsx
 * `Jaws`), from the layout in body-figures.json; a tap on a tooth calls [onTap] with its number.
 */
@Composable
private fun Jaws(milk: Boolean, look: (Int) -> ToothLook, onTap: (Int) -> Unit) {
    val t = LocalStrings.current
    val figures = BodyFigures.get(LocalContext.current)
    val spots = if (milk) figures.milk else figures.permanent
    val measurer = rememberTextMeasurer()
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val line = MaterialTheme.colorScheme.outline
    val strong = MaterialTheme.colorScheme.onSurface
    val number = MaterialTheme.typography.labelSmall
    val jaw = MaterialTheme.typography.labelMedium.copy(color = muted)
    val w = figures.teethWidth
    val h = figures.teethHeight
    // The tap handler outlives a recomposition; it must call the latest onTap, not the first.
    val tap by rememberUpdatedState(onTap)
    Canvas(
        Modifier.fillMaxWidth().widthIn(max = 420.dp).aspectRatio(w / h)
            .semantics { contentDescription = t("detail.teeth") }
            .pointerInput(milk) {
                detectTapGestures { pos ->
                    val k = size.width / w
                    toothAt(spots, pos.x / k, pos.y / k)?.let { tap(it) }
                }
            },
    ) {
        val k = size.width / w
        fun label(text: String, x: Float, y: Float, style: TextStyle) {
            val m = measurer.measure(text, style)
            drawText(m, topLeft = Offset(x * k - m.size.width / 2f, y * k - m.size.height / 2f))
        }
        label(t("detail.teeth.upper"), w / 2, h / 2 - 34, jaw)
        label(t("detail.teeth.lower"), w / 2, h / 2 + 36, jaw)
        label("← ${t("detail.teeth.right")}", w / 2 - 70, h / 2, jaw)
        label("${t("detail.teeth.left")} →", w / 2 + 70, h / 2, jaw)
        for (s in spots) {
            val l = look(s.n)
            val center = Offset(s.x * k, s.y * k)
            val half = Size(s.size * 2 * k, s.size * 1.9f * k)
            val topLeft = Offset(center.x - half.width / 2, center.y - half.height / 2)
            val corner = CornerRadius(s.size * 0.6f * k)
            rotate(s.angle, pivot = center) {
                drawRoundRect(l.fill, topLeft, half, corner)
                drawRoundRect(
                    if (l.outlined) strong else line,
                    topLeft,
                    half,
                    corner,
                    style = Stroke(width = if (l.outlined) 2.5.dp.toPx() else 1.dp.toPx()),
                )
            }
            label(s.n.toString(), s.x, s.y, number.copy(color = l.text))
        }
    }
}

/** The permanent / milk teeth switch. */
@Composable
private fun MilkSwitch(milk: Boolean, onChange: (Boolean) -> Unit) {
    val t = LocalStrings.current
    SingleChoiceSegmentedButtonRow {
        listOf(false, true).forEachIndexed { i, m ->
            SegmentedButton(selected = milk == m, onClick = { onChange(m) }, shape = SegmentedButtonDefaults.itemShape(i, 2)) {
                Text(t(if (m) "detail.teeth.milk" else "detail.teeth.permanent"))
            }
        }
    }
}

/**
 * Pick the teeth a dental entry is about (ToothChart.tsx): FDI numbers, permanent and milk teeth on
 * separate charts with their own numbers; what is picked on either stays picked when switching.
 */
@Composable
fun ToothPicker(teeth: List<Int>, milkFirst: Boolean, onChange: (List<Int>) -> Unit) {
    val t = LocalStrings.current
    val permanent = teeth.filterNot(::isMilkTooth)
    var milk by remember { mutableStateOf(if (teeth.any(::isMilkTooth)) permanent.isEmpty() || milkFirst else milkFirst && permanent.isEmpty()) }
    val primary = MaterialTheme.colorScheme.primary
    val onPrimary = MaterialTheme.colorScheme.onPrimary
    val surface = MaterialTheme.colorScheme.surface
    val onSurface = MaterialTheme.colorScheme.onSurface
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(t("detail.teeth"), style = MaterialTheme.typography.labelLarge)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MilkSwitch(milk) { milk = it }
            if (teeth.isNotEmpty()) TextButton(onClick = { onChange(emptyList()) }) { Text(t("detail.teeth.clear")) }
        }
        Jaws(
            milk,
            look = { n -> if (n in teeth) ToothLook(primary, onPrimary, false) else ToothLook(surface, onSurface, false) },
            onTap = { n -> onChange(toggleTooth(teeth, n)) },
        )
        Text(
            if (teeth.isEmpty()) t("detail.teeth.hint") else teethText(teeth, t),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The teeth on the body map's mouth (ToothChart.tsx `ToothHeat`): each coloured by how many entries
 * name it, the picked one outlined; picking one filters to it, picking it again lets go.
 */
@Composable
fun ToothHeat(counts: Map<Int, Int>, picked: Int?, milkFirst: Boolean, colors: List<Color>, level: (Int) -> Int, onPick: (Int?) -> Unit) {
    val t = LocalStrings.current
    var milk by remember(milkFirst) { mutableStateOf(milkFirst) }
    val onSurface = MaterialTheme.colorScheme.onSurface
    val surface = MaterialTheme.colorScheme.surface
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(t("detail.teeth"), style = MaterialTheme.typography.titleSmall)
            MilkSwitch(milk) { milk = it }
        }
        Jaws(
            milk,
            look = { n ->
                val l = level(counts[n] ?: 0)
                ToothLook(if (l == 0) surface else colors[l], onSurface, picked == n)
            },
            onTap = { n -> onPick(if (picked == n) null else n) },
        )
        Text(
            t(if (counts.isEmpty()) "bodyMap.noTeeth" else "bodyMap.teethHint"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
