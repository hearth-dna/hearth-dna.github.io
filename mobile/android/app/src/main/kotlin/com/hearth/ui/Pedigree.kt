package com.hearth.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.hearth.family.PedigreeNode

val NODE_W = 150.dp
val NODE_H = 62.dp
private val GAP_X = 40.dp
private val GAP_Y = 90.dp

/** A parent→child line: its colour and weight, dashed or not, and the text drawn on its middle. */
data class PedigreeEdge(
    val from: PedigreeNode,
    val to: PedigreeNode,
    val color: Color? = null,
    val width: Dp = 1.2.dp,
    val dashed: Boolean = false,
    val label: String? = null,
    val labelColor: Color? = null,
)

/** Parent→child pairs of a layout, skipping parents that are not in it. */
fun pedigreeEdges(nodes: List<PedigreeNode>): List<PedigreeEdge> {
    val byId = nodes.associateBy { it.person.id }
    return nodes.flatMap { to -> to.parents.mapNotNull { pid -> byId[pid]?.let { PedigreeEdge(it, to) } } }
}

/**
 * Generation by generation, one slot per person, a line from every parent to every child
 * (Pedigree.tsx, with the same geometry). Callers draw each box and style the lines, so the family
 * tree and the per-rsid inheritance tree line up the same way. Scrolls sideways when wide.
 */
@Composable
fun Pedigree(nodes: List<PedigreeNode>, edges: List<PedigreeEdge>, modifier: Modifier = Modifier, node: @Composable (PedigreeNode) -> Unit) {
    val cols = maxOf(1, nodes.maxOfOrNull { it.column + 1 } ?: 1)
    val rows = maxOf(1, nodes.maxOfOrNull { it.generation + 1 } ?: 1)
    fun x(col: Int) = (NODE_W + GAP_X) * col + GAP_X / 2
    fun y(gen: Int) = (NODE_H + GAP_Y) * gen + 10.dp
    val width = (NODE_W + GAP_X) * cols
    val height = (NODE_H + GAP_Y) * rows - GAP_Y + 20.dp
    val muted = MaterialTheme.colorScheme.outline
    Box(modifier.horizontalScroll(rememberScrollState())) {
        Box(Modifier.size(width, height)) {
            Canvas(Modifier.size(width, height)) {
                for (e in edges) {
                    val start = Offset((x(e.from.column) + NODE_W / 2).toPx(), (y(e.from.generation) + NODE_H).toPx())
                    val end = Offset((x(e.to.column) + NODE_W / 2).toPx(), y(e.to.generation).toPx())
                    drawLine(
                        e.color ?: muted,
                        start,
                        end,
                        strokeWidth = e.width.toPx(),
                        pathEffect = if (e.dashed) PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx())) else null,
                    )
                }
            }
            for (e in edges) {
                val label = e.label ?: continue
                val cx = (x(e.from.column) + x(e.to.column)) / 2 + NODE_W / 2
                val cy = (y(e.from.generation) + NODE_H + y(e.to.generation)) / 2
                // A small plate behind the letters, as the web's halo stroke, so the line stays readable.
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    shape = MaterialTheme.shapes.extraSmall,
                    modifier = Modifier.offset(cx - 14.dp, cy - 11.dp).size(28.dp, 22.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(label, fontWeight = FontWeight.Bold, color = e.labelColor ?: MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
            for (n in nodes) {
                Box(Modifier.offset(x(n.column), y(n.generation)).size(NODE_W, NODE_H)) { node(n) }
            }
        }
    }
}
