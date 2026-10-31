package com.hearth.health

import com.hearth.data.HealthEntry
import com.hearth.data.HealthKind
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

/** Mirrors frontend/src/health/body.test.ts and teeth.test.ts where the functions were ported. */
class BodyTest {
    private fun at(bodyPart: String, side: String = "", details: String = "", id: String = "x") =
        HealthEntry(id, "p", "2026-10-01", "", HealthKind.SYMPTOM, "Pain", "", "", bodyPart, null, emptyList(), null, null, "", "", side, details)

    @Test fun `reads a typed body part as the suggested one`() {
        assertEquals("knees", bodyKey(" Knee "))
        assertEquals("feet", bodyKey("foot"))
        assertEquals("mouth", bodyKey("Teeth"))
        assertEquals("lower back", bodyKey("LOWER  back"))
        assertEquals("колено", bodyKey("Колено"))
        assertEquals("", bodyKey(""))
    }

    @Test fun `counts each part, and each side with both and unrecorded sides on either`() {
        val heat = bodyHeat(listOf(at("knees", "left"), at("Knee", "both"), at("knees"), at("knees", "right"), at("head"), at("")))
        assertEquals(4, regionCount(heat, "knees"))
        assertEquals(3, regionCount(heat, "knees", "left"))
        assertEquals(3, regionCount(heat, "knees", "right"))
        assertEquals(1, regionCount(heat, "head"))
        assertEquals(0, regionCount(heat, "feet", "left"))
        assertEquals(3, heat.max)
        assertEquals(setOf("head", "knees"), heat.parts.keys)
    }

    @Test fun `scales the colour to the busiest part`() {
        assertEquals(listOf(0, 1, 1, 2, 5), listOf(0, 1, 2, 3, 10).map { heatLevel(it, 10) })
        assertEquals(5, heatLevel(1, 0))
        assertTrue(onSide("", "left"))
        assertFalse(onSide("right", "left"))
    }

    @Test fun `filters the log the way the map counts it, and by tooth`() {
        val log = listOf(at("knees", "left", id = "l"), at("Knee", "right", id = "r"), at("knee", id = "n"), at("head", id = "h"))
        assertEquals(listOf("l", "r", "n"), filterHealthLog(log, HealthFilter(bodyPart = "knees")).map { it.id })
        assertEquals(listOf("l", "n"), filterHealthLog(log, HealthFilter(bodyPart = "knees", side = "left")).map { it.id })
        val dental = listOf(at("mouth", details = """{"teeth":"16 26"}""", id = "d")) + log
        assertEquals(listOf("d"), filterHealthLog(dental, HealthFilter(tooth = 26)).map { it.id })
    }

    @Test fun `reads and writes teeth the way the web does`() {
        assertEquals(listOf(16, 26, 55), parseTeeth("26 16 x 16 99 55,19"))
        assertEquals("16 26", formatTeeth(listOf(26, 16)))
        assertEquals(listOf(11, 26), toggleTooth(listOf(26), 11))
        assertEquals(listOf(26), toggleTooth(listOf(16, 26), 16))
        assertEquals("""{"teeth":"16 55"}""", detailsWithTeeth(listOf(55, 16)))
        assertEquals("", detailsWithTeeth(emptyList()))
        assertEquals(listOf(16, 55), teethOf("""{"teeth":"16 55","trigger":"cold"}"""))
        assertEquals(emptyList<Int>(), teethOf("not json"))
        assertEquals(listOf("incisor", "canine", "premolar", "molar", "molar"), listOf(11, 13, 14, 16, 54).map(::toothType))
        assertEquals(listOf(18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28), PERMANENT_TEETH[0])
        assertEquals(listOf(85, 84, 83, 82, 81, 71, 72, 73, 74, 75), MILK_TEETH[1])
        assertEquals(mapOf(16 to 2, 26 to 1, 55 to 1), teethHeat(listOf(at("mouth", details = """{"teeth":"16 26"}"""), at("mouth", details = """{"teeth":"16 55"}"""), at("head"))))
    }

    @Test fun `picks the age group from a birth year, adult when unknown`() {
        assertEquals(listOf("adult", "adult", "teen", "child", "young", "toddler"), listOf(null, 16.0, 13.0, 12.9, 4.0, 3.9).map(::stageOf))
        assertEquals(10.0, ageFromYear(2016, LocalDate.of(2026, 7, 1))!!, 0.01)
    }

    @Test fun `the figures file has every figure, its paths in M L C Q Z only`() {
        val json = JSONObject(File("../../body-figures.json").readText())
        val figures = json.getJSONObject("figures")
        for (sex in listOf("male", "female")) for (stage in STAGES) {
            val regions = figures.getJSONArray("$sex-$stage")
            assertTrue("$sex-$stage", regions.length() > 50)
            for (i in 0 until regions.length()) {
                val d = regions.getJSONObject(i).getJSONArray("d")
                for (j in 0 until d.length()) assertTrue(d.getString(j).all { it in "MLCQZ0123456789.- " })
            }
        }
        assertEquals(32, json.getJSONObject("teeth").getJSONArray("permanent").length())
        assertEquals(20, json.getJSONObject("teeth").getJSONArray("milk").length())
    }

    private val figures by lazy { Figures.parse(File("../../body-figures.json").readText()) }

    @Test fun `finds the part a tap lands on, the one drawn on top`() {
        val male = figures.regions("male", "adult")
        assertEquals("head", regionAt(male, 364f, 100f)?.part)
        // The lungs are drawn over the chest; the person's right is the viewer's left from the front.
        val lung = regionAt(male, 300f, 340f)
        assertEquals("lungs", lung?.part)
        assertEquals("right", lung?.side)
        assertEquals(null, regionAt(male, 5f, 5f))
        assertTrue("knees" in figures.drawn && "skin" !in figures.drawn)
    }

    @Test fun `zooms on a part's box, one side when a side is picked`() {
        val male = figures.regions("male", "adult")
        val (x, _, s) = zoomOn(male, figures.width, figures.height, "knees", "left")!!
        assertTrue(x > figures.mid.getValue("front"))
        assertTrue(s > 1f && s <= 5f)
        assertEquals(null, zoomOn(male, figures.width, figures.height, "skin", ""))
        // The back is only on the back figure.
        assertTrue(zoomOn(male, figures.width, figures.height, "lower back", "")!!.first > figures.mid.getValue("back") - 200)
    }

    @Test fun `finds the tooth a tap lands on`() {
        val t16 = figures.permanent.first { it.n == 16 }
        assertEquals(16, toothAt(figures.permanent, t16.x + 1, t16.y - 1))
        assertEquals(null, toothAt(figures.permanent, figures.teethWidth / 2, figures.teethHeight / 2))
    }
}
