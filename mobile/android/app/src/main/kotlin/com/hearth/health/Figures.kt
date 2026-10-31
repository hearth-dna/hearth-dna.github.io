package com.hearth.health

import org.json.JSONObject

/**
 * The body map's figures and the tooth chart's layout, from `body-figures.json` (built from the
 * web's drawing by frontend/src/components/mobileFigures.ts, copied in by `make mobile-assets`):
 * every figure already reshaped for its age group and placed in one scene, its paths in M, L, C,
 * Q and Z only. Plain Kotlin, so the tests run it: the screens only draw what this reads, and ask
 * it which part a tap landed on.
 */

class FigureRegion(
    val part: String,
    /** "left" or "right" for one side of a paired part, else "". */
    val side: String,
    /** "front" or "back". */
    val view: String,
    /** Drawn over the body (an organ, a feature of the face), as an outline until it has entries. */
    val overlay: Boolean,
    /** Bounding box x0, y0, x1, y1 in the scene. */
    val box: FloatArray,
    /** SVG path data, one per piece. */
    val paths: List<String>,
) {
    /** The pieces as polygons, for hit testing: curves cut into short straight steps. */
    val polygons: List<FloatArray> by lazy { paths.flatMap(::polygonsOf) }

    fun contains(x: Float, y: Float): Boolean =
        x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] && polygons.any { inside(it, x, y) }
}

class ToothSpot(val n: Int, val x: Float, val y: Float, val angle: Float, val size: Float)

class Figures(
    val width: Float,
    val height: Float,
    /** Each view's midline in the scene. */
    val mid: Map<String, Float>,
    private val figures: Map<String, List<FigureRegion>>,
    val teethWidth: Float,
    val teethHeight: Float,
    val permanent: List<ToothSpot>,
    val milk: List<ToothSpot>,
) {
    /** One figure: "male" or "female", and an age group from [STAGES]. Drawn in list order. */
    fun regions(sex: String, stage: String): List<FigureRegion> = figures["$sex-$stage"] ?: figures.getValue("male-adult")

    /** Every part some figure draws; the rest go under "elsewhere". */
    val drawn: Set<String> by lazy { figures.values.flatten().map { it.part }.toSet() }

    companion object {
        fun parse(text: String): Figures {
            val json = JSONObject(text)
            val scene = json.getJSONObject("scene")
            val mid = scene.getJSONObject("mid")
            val figs = json.getJSONObject("figures")
            val figures = figs.keys().asSequence().associateWith { key ->
                val arr = figs.getJSONArray(key)
                (0 until arr.length()).map { i ->
                    val r = arr.getJSONObject(i)
                    val box = r.getJSONArray("box")
                    val d = r.getJSONArray("d")
                    FigureRegion(
                        part = r.getString("part"),
                        side = r.getString("side"),
                        view = r.getString("view"),
                        overlay = r.optBoolean("overlay", false),
                        box = FloatArray(4) { box.getDouble(it).toFloat() },
                        paths = (0 until d.length()).map { d.getString(it) },
                    )
                }
            }
            val teeth = json.getJSONObject("teeth")
            fun spots(name: String) = teeth.getJSONArray(name).let { a ->
                (0 until a.length()).map {
                    val s = a.getJSONObject(it)
                    ToothSpot(s.getInt("n"), s.getDouble("x").toFloat(), s.getDouble("y").toFloat(), s.getDouble("angle").toFloat(), s.getDouble("size").toFloat())
                }
            }
            return Figures(
                width = scene.getDouble("w").toFloat(),
                height = scene.getDouble("h").toFloat(),
                mid = mid.keys().asSequence().associateWith { mid.getDouble(it).toFloat() },
                figures = figures,
                teethWidth = teeth.getDouble("w").toFloat(),
                teethHeight = teeth.getDouble("h").toFloat(),
                permanent = spots("permanent"),
                milk = spots("milk"),
            )
        }
    }
}

/** The region a point in the scene falls on: the last drawn, as that is the one on top; null for none. */
fun regionAt(regions: List<FigureRegion>, x: Float, y: Float): FigureRegion? = regions.lastOrNull { it.contains(x, y) }

/**
 * Where to look for a picked part: its regions on the front figure where it has any (on the back
 * for the back), one side only when a side is picked, as centre x, y and a zoom of at most five.
 * Null when the figure does not draw it. BodyMap.tsx `zoomOn`.
 */
fun zoomOn(regions: List<FigureRegion>, width: Float, height: Float, part: String, side: String): Triple<Float, Float, Float>? {
    val all = regions.filter { it.part == part && (side.isEmpty() || it.side == side) }
    val view = if (all.any { it.view == "front" }) "front" else "back"
    val boxes = all.filter { it.view == view }.map { it.box }
    if (boxes.isEmpty()) return null
    val x0 = boxes.minOf { it[0] }
    val y0 = boxes.minOf { it[1] }
    val x1 = boxes.maxOf { it[2] }
    val y1 = boxes.maxOf { it[3] }
    val s = minOf(5f, width / (x1 - x0 + 240), height / (y1 - y0 + 240))
    return Triple((x0 + x1) / 2, (y0 + y1) / 2, s)
}

/** The tooth a tap at x, y (chart coordinates) lands on, if any. */
fun toothAt(spots: List<ToothSpot>, x: Float, y: Float): Int? =
    spots.filter { (it.x - x) * (it.x - x) + (it.y - y) * (it.y - y) <= it.size * it.size * 1.2f }
        .minByOrNull { (it.x - x) * (it.x - x) + (it.y - y) * (it.y - y) }?.n

/** Path data in M, L, C, Q and Z (absolute) → closed polygons, each curve in eight steps. */
internal fun polygonsOf(d: String): List<FloatArray> {
    val out = mutableListOf<FloatArray>()
    var cur = mutableListOf<Float>()
    var x = 0f
    var y = 0f
    val tokens = Regex("[MLCQZ]|-?\\d*\\.?\\d+").findAll(d).map { it.value }.toList()
    var i = 0
    fun num() = tokens[i++].toFloat()
    fun close() {
        if (cur.size >= 6) out.add(cur.toFloatArray())
        cur = mutableListOf()
    }
    var cmd = ""
    while (i < tokens.size) {
        if (tokens[i][0].isLetter()) cmd = tokens[i++]
        when (cmd) {
            "M" -> { close(); x = num(); y = num(); cur.add(x); cur.add(y); cmd = "L" }
            "L" -> { x = num(); y = num(); cur.add(x); cur.add(y) }
            "C" -> {
                val (x1, y1, x2, y2) = listOf(num(), num(), num(), num())
                val ex = num()
                val ey = num()
                for (k in 1..8) {
                    val t = k / 8f
                    val u = 1 - t
                    cur.add(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex)
                    cur.add(u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey)
                }
                x = ex
                y = ey
            }
            "Q" -> {
                val cx = num()
                val cy = num()
                val ex = num()
                val ey = num()
                for (k in 1..8) {
                    val t = k / 8f
                    val u = 1 - t
                    cur.add(u * u * x + 2 * u * t * cx + t * t * ex)
                    cur.add(u * u * y + 2 * u * t * cy + t * t * ey)
                }
                x = ex
                y = ey
            }
            "Z" -> { close(); cmd = "" }
            else -> i++
        }
    }
    close()
    return out
}

/** Even-odd point in polygon (x, y pairs). */
private fun inside(p: FloatArray, x: Float, y: Float): Boolean {
    var c = false
    var j = p.size - 2
    var i = 0
    while (i < p.size) {
        val xi = p[i]
        val yi = p[i + 1]
        val xj = p[j]
        val yj = p[j + 1]
        if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c
        j = i
        i += 2
    }
    return c
}
