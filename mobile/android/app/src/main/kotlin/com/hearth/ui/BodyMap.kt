package com.hearth.ui

import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.hearth.health.BODY_PARTS
import com.hearth.health.BodyHeat
import com.hearth.health.Figures
import com.hearth.health.HEAT_STEPS
import com.hearth.health.STAGES
import com.hearth.health.bodyKey
import com.hearth.health.heatLevel
import com.hearth.health.regionAt
import com.hearth.health.regionCount
import com.hearth.health.zoomOn

/** body-figures.json, read once per process (`make mobile-assets` copies it in). */
object BodyFigures {
    @Volatile private var cached: Figures? = null

    fun get(context: Context): Figures = cached ?: synchronized(this) {
        cached ?: Figures.parse(context.assets.open("body-figures.json").bufferedReader().use { it.readText() }).also { cached = it }
    }
}

/**
 * The colour steps of the map, 0 (none: the body's own tone) to [HEAT_STEPS]: one hue, the web's
 * `--series-2`, mixed into the surface (styles.css `.heat-*`).
 */
@Composable
fun heatColors(): List<Color> {
    val surface = MaterialTheme.colorScheme.surface
    val orange = if (isSystemInDarkTheme()) Color(0xFFD95926) else Color(0xFFEB6834)
    return listOf(lerp(surface, MaterialTheme.colorScheme.onSurface, 0.14f)) +
        listOf(0.18f, 0.36f, 0.55f, 0.75f, 1f).map { lerp(surface, orange, it) }
}

/**
 * The health log on a body (BodyMap.tsx): a front and a back figure, male or female, shaped for
 * the age group; each part (each side of a paired one) coloured by how many of the shown entries
 * name it. A tap on a part zooms in on it and filters the log to it; on the mouth the teeth get the
 * same colours, and a tooth can be picked too. Parts with no place on the figure are chips below.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BodyMap(
    heat: BodyHeat,
    teeth: Map<Int, Int>,
    sex: String,
    stage: String,
    part: String,
    side: String,
    tooth: Int?,
    onPick: (part: String, side: String) -> Unit,
    onTooth: (Int?) -> Unit,
) {
    val t = LocalStrings.current
    val figures = BodyFigures.get(LocalContext.current)
    var shownSex by remember(sex) { mutableStateOf(sex) }
    var shownStage by remember(stage) { mutableStateOf(stage) }
    val regions = remember(shownSex, shownStage) { figures.regions(shownSex, shownStage) }
    val paths = remember(regions) { regions.map { r -> r.paths.map { PathParser().parsePathString(it).toPath() } } }
    val picked = bodyKey(part)
    val target = if (picked.isEmpty()) null else zoomOn(regions, figures.width, figures.height, picked, side)
    val cx by animateFloatAsState(target?.first ?: (figures.width / 2), label = "cx")
    val cy by animateFloatAsState(target?.second ?: (figures.height / 2), label = "cy")
    val zoom by animateFloatAsState(target?.third ?: 1f, label = "zoom")
    val colors = heatColors()
    val outline = MaterialTheme.colorScheme.onSurfaceVariant
    val selected = MaterialTheme.colorScheme.onSurface
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val child = shownStage != "adult"
    val name = { p: String -> if (p in BODY_PARTS) t("bodyPart.$p") else p }
    val label = { p: String, s: String, n: Int ->
        t("bodyMap.region", "part" to (if (s.isEmpty()) name(p) else "${name(p)} · ${t("side.$s")}"), "n" to n)
    }
    val pick = { p: String, s: String -> if (p == picked && s == side) onPick("", "") else onPick(p, s) }
    // The tap handler outlives recompositions and animation frames: it reads the latest of these.
    val tapAt by rememberUpdatedState { x: Float, y: Float, width: Float ->
        val k = width / figures.width * zoom
        val hit = regionAt(regions, x / k + cx, y / k + cy)
        if (hit != null) pick(hit.part, hit.side) else if (picked.isNotEmpty()) onPick("", "")
    }
    val teethMax = maxOf(heat.max, teeth.values.maxOrNull() ?: 0)
    val other = heat.parts.keys.filter { it !in figures.drawn }.sorted()

    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (picked.isEmpty()) t("bodyMap.hint") else label(picked, side, regionCount(heat, picked, side)),
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color = muted,
            )
            if (picked.isNotEmpty()) TextButton(onClick = { onPick("", "") }) { Text(t("bodyMap.zoomOut")) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                listOf("male", "female").forEachIndexed { i, f ->
                    SegmentedButton(selected = shownSex == f, onClick = { shownSex = f }, shape = SegmentedButtonDefaults.itemShape(i, 2)) {
                        Text(t(if (!child) "bodyMap.$f" else if (f == "male") "bodyMap.boy" else "bodyMap.girl"))
                    }
                }
            }
            Picker(t("bodyMap.age"), shownStage, STAGES.map { it to t("bodyMap.stage.$it") }, modifier = Modifier.weight(1f)) { shownStage = it }
        }
        Canvas(
            Modifier.fillMaxWidth().aspectRatio(figures.width / figures.height).clipToBounds()
                .semantics { contentDescription = t("bodyMap.title") }
                .pointerInput(Unit) {
                    detectTapGestures { pos -> tapAt(pos.x - size.width / 2f, pos.y - size.height / 2f, size.width.toFloat()) }
                },
        ) {
            val k = size.width / figures.width * zoom
            withTransform({
                translate(size.width / 2f, size.height / 2f)
                scale(k, k, pivot = Offset.Zero)
                translate(-cx, -cy)
            }) {
                val thin = 1.dp.toPx() / k
                val dashes = PathEffect.dashPathEffect(floatArrayOf(4 * thin, 3 * thin))
                regions.forEachIndexed { i, r ->
                    val level = heatLevel(regionCount(heat, r.part, r.side), heat.max)
                    val on = r.part == picked && (side.isEmpty() || r.side.isEmpty() || r.side == side)
                    for (p in paths[i]) {
                        if (r.overlay && level == 0) drawPath(p, outline, style = Stroke(width = thin, pathEffect = dashes))
                        else drawPath(p, colors[level])
                        if (on) drawPath(p, selected, style = Stroke(width = 1.5f * thin))
                    }
                }
            }
        }
        if (picked.isEmpty()) {
            // Under each figure: which side of the person is which. Front at a quarter, back at three quarters.
            Row(Modifier.fillMaxWidth()) {
                for (key in listOf("bodyMap.r", "bodyMap.front", "bodyMap.l", "bodyMap.l", "bodyMap.back", "bodyMap.r")) {
                    Text(t(key), Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = muted, textAlign = TextAlign.Center)
                }
            }
        }
        if (picked == "mouth") {
            ToothHeat(
                counts = teeth,
                picked = tooth,
                milkFirst = shownStage == "toddler" || shownStage == "young" || (teeth.isNotEmpty() && teeth.keys.all { it > 50 }),
                colors = colors,
                level = { heatLevel(it, teethMax) },
                onPick = onTooth,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(t("bodyMap.fewer"), style = MaterialTheme.typography.labelSmall, color = muted)
            for (l in 1..HEAT_STEPS) Box(Modifier.size(14.dp).clip(RoundedCornerShape(3.dp)).background(colors[l]))
            Text(t("bodyMap.more", "n" to if (picked == "mouth") teethMax else heat.max), style = MaterialTheme.typography.labelSmall, color = muted)
        }
        if (other.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(t("bodyMap.elsewhere"), Modifier.align(Alignment.CenterVertically), style = MaterialTheme.typography.labelMedium, color = muted)
                for (p in other) {
                    val n = heat.parts[p] ?: 0
                    FilterChip(
                        selected = p == picked,
                        onClick = { pick(p, "") },
                        label = { Text("${name(p)}  $n") },
                        leadingIcon = { Box(Modifier.size(12.dp).clip(RoundedCornerShape(3.dp)).background(colors[heatLevel(n, heat.max)])) },
                    )
                }
            }
        }
    }
}
