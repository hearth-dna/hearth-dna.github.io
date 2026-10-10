package com.hearth.kb

import com.hearth.data.Call
import com.hearth.data.Person
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Mirrors frontend/src/kb/viewer.test.ts, against the real kb.json. */
class ViewerTest {
    private val kb = Kb.parse(File("../../../frontend/public/kb.json").readText())

    private fun person(id: String) = Person(id, id, id, "unknown", null, "", "")
    private fun call(rsid: String, a1: String, a2: String) = Call(rsid, "1", 1, a1, a2)

    @Test fun `ranks established, medical, high-impact markers first`() {
        val ranked = rankEntries(kb)
        assertEquals(kb.entries.size, ranked.size)
        val grades = ranked.joinToString("") { it.evidence }
        assertEquals(grades.toList().sorted().joinToString(""), grades)
        assertEquals("A", ranked[0].evidence)
        assertTrue(ranked[0].topic != "brain_and_body")
    }

    private val findingsBy = mapOf(
        "a" to computeFindings(kb, listOf(call("rs7903146", "T", "T"), call("rs4680", "A", "G"))),
        "b" to computeFindings(kb, listOf(call("rs7903146", "C", "C"))),
    )

    @Test fun `shows every marker by default, with genotypes where people have them`() {
        val rows = viewerRows(kb, findingsBy, listOf("a", "b"), ViewerFilter())
        assertEquals(kb.entries.size, rows.size)
        assertEquals(setOf("a", "b"), rows.first { it.entry.rsid == "rs7903146" }.findings.keys)
        assertNull(rows.first { it.entry.rsid == "rs4680" }.findings["b"])
    }

    @Test fun `filters by area, text and notability`() {
        fun ids(f: ViewerFilter, people: List<String> = listOf("a", "b")) = viewerRows(kb, findingsBy, people, f).map { it.entry.rsid }
        assertTrue("rs7903146" in ids(ViewerFilter(areas = listOf("diabetes"))))
        assertTrue("rs4680" !in ids(ViewerFilter(areas = listOf("diabetes"))))
        assertTrue(ids(ViewerFilter(areas = listOf("diabetes", "mental"))).containsAll(listOf("rs7903146", "rs4680")))
        assertEquals(listOf("rs7903146"), ids(ViewerFilter(query = "TCF7L2")))
        assertEquals(listOf("rs7903146"), ids(ViewerFilter(notable = true)))
        assertEquals(emptyList<String>(), ids(ViewerFilter(notable = true), listOf("b")))
    }

    @Test fun `packs only shown people who have genotypes in the rows`() {
        val rows = viewerRows(kb, mapOf("a" to computeFindings(kb, listOf(call("rs7903146", "C", "T")))), listOf("a", "b"), ViewerFilter(areas = listOf("diabetes")))
        val packed = viewerPackPeople(rows, listOf(person("a"), person("b")))
        assertEquals(listOf("a"), packed.map { it.person.id })
        assertEquals(listOf("rs7903146"), packed[0].findings.map { it.entry.rsid })
    }

    @Test fun `asks about the chosen areas in English`() {
        assertTrue(viewerQuestion(kb, listOf("memory", "diabetes")).startsWith("What do these genotypes mean for diabetes and weight, memory"))
        assertTrue(viewerQuestion(kb, emptyList()).startsWith("What do these genotypes mean,"))
    }
}
