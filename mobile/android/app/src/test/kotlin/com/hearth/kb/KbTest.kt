package com.hearth.kb

import com.hearth.data.Call
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Mirrors frontend/src/kb/kb.test.ts and sortFindings.test.ts, against the real kb.json. */
class KbTest {
    private val kb = Kb.parse(File("../../../frontend/public/kb.json").readText())

    @Test fun `has entries with sorted genotype keys`() {
        assertTrue(kb.entries.size > 20)
        for (e in kb.entries) for (k in e.genotypes.keys) assertEquals(normGenotype(k.substring(0, 1), k.substring(1, 2)), k)
    }

    @Test fun `computes findings and risk copies regardless of allele order`() {
        val f = computeFindings(
            kb,
            listOf(Call("rs7903146", "10", 1, "T", "C"), Call("rs12248560", "10", 2, "T", "T"), Call("rs999999", "1", 3, "A", "A")),
        )
        assertEquals(2, f.size)
        val tcf = f.first { it.entry.rsid == "rs7903146" }
        assertEquals("CT", tcf.genotype)
        assertEquals(1, tcf.riskCopies)
        assertEquals(2.0, tcf.match!!.magnitude, 0.0)
        assertEquals("rs12248560", f[0].entry.rsid)
    }

    @Test fun `searches drugs and conditions`() {
        assertTrue(searchKb(kb, "clopidogrel").map { it.rsid }.contains("rs4244285"))
        assertTrue(searchKb(kb, "diabetes").map { it.gene }.contains("TCF7L2"))
        assertEquals(emptyList<KbEntry>(), searchKb(kb, ""))
    }

    private fun finding(rsid: String, gene: String, evidence: String, topic: String, magnitude: Double?, riskCopies: Int) = Finding(
        KbEntry(rsid, gene, "", "A", evidence, "", emptyMap(), emptyList(), emptyList(), emptyList(), topic, ""),
        "AA", Call(rsid, "1", 1, "A", "A"), magnitude?.let { KbGenotype("", it) }, riskCopies,
    )
    private val rows = listOf(
        finding("rs1", "MTHFR", "C", "b", 2.0, 1),
        finding("rs2", "APOE", "A", "a", 3.0, 2),
        finding("rs3", "CYP2C19", "B", "c", null, 0),
        finding("rs4", "APOE", "A", "a", 1.0, 2),
    )
    private fun ids(f: List<Finding>) = f.map { it.entry.rsid }

    @Test fun `sorts findings like the web`() {
        assertEquals(listOf("rs2", "rs4", "rs3", "rs1"), ids(sortFindings(rows, FindingSortKey.GENE, true)))
        assertEquals(listOf("rs1", "rs3", "rs4", "rs2"), ids(sortFindings(rows, FindingSortKey.GENE, false)))
        assertEquals(listOf("rs2", "rs1", "rs4", "rs3"), ids(sortFindings(rows, FindingSortKey.MAGNITUDE, false)))
        assertEquals(listOf("rs3", "rs4", "rs1", "rs2"), ids(sortFindings(rows, FindingSortKey.MAGNITUDE, true)))
        assertEquals(listOf("rs2", "rs4", "rs3", "rs1"), ids(sortFindings(rows, FindingSortKey.EVIDENCE, true)))
        assertEquals(listOf("rs2", "rs4", "rs1", "rs3"), ids(sortFindings(rows, FindingSortKey.RISK_COPIES, false)))
        assertEquals(listOf("rs2", "rs4", "rs1", "rs3"), ids(sortFindings(rows, FindingSortKey.TOPIC, true)))
    }
}
