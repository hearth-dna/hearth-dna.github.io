package com.hearth.ask

import com.hearth.data.Call
import com.hearth.data.HealthEntry
import com.hearth.data.HealthKind
import com.hearth.data.Person
import com.hearth.kb.Finding
import com.hearth.kb.Kb
import com.hearth.kb.KbEntry
import com.hearth.kb.KbGenotype
import com.hearth.kb.computeFindings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/**
 * Mirrors the tests in frontend/src/ask. The first pack is compared with the web's own snapshot
 * (ask/__snapshots__/contextPack.test.ts.snap), so a drift in either app fails here.
 */
class AskTest {
    private val kb = Kb.parse(File("../../../frontend/public/kb.json").readText())

    private val entry = KbEntry(
        "rs4244285", "CYP2C19", "CYP2C19*2", "A", "A", "Loss-of-function allele.",
        mapOf("AG" to KbGenotype("*1/*2 intermediate metaboliser", 2.0)), listOf("https://cpicpgx.org/x"),
        emptyList(), emptyList(), "pharmacogenomics", "human",
    )
    private val finding = Finding(entry, "AG", Call("rs4244285", "10", 1, "A", "G"), entry.genotypes["AG"], 1)
    private val vova = Person("p1", "vova", "Vova", "male", 1984, "", "t")

    private fun h(
        id: String, date: String, kind: HealthKind, title: String, body: String = "", time: String = "", bodyPart: String = "",
        severity: Int? = null, tags: List<String> = emptyList(), value: Double? = null, value2: Double? = null, unit: String = "",
        personId: String = "p1",
    ) = HealthEntry(id, personId, date, time, kind, title, body, "", bodyPart, severity, tags, value, value2, unit, "t")

    @Test fun `pack matches the web snapshot`() {
        val pack = buildContextPack(PackOptions("Clopidogrel?", listOf(PackPerson(vova, listOf(finding))), realNames = false, year = 2026))
        val snap = File("../../../frontend/src/ask/__snapshots__/contextPack.test.ts.snap").readText()
        val web = Regex("deterministic 1`\\] = `\\n\"(.*)\"\\n`;", RegexOption.DOT_MATCHES_ALL).find(snap)!!.groupValues[1]
        assertEquals(web, pack)
        assertFalse(pack.contains("Vova"))
    }

    @Test fun `real names, exact age and the template`() {
        val pack = buildContextPack(PackOptions("q", listOf(PackPerson(vova, listOf(finding))), realNames = true, year = 2026, template = PROMPTS[2]))
        assertTrue(pack.contains("## Vova, male, 42"))
        assertTrue(pack.contains(PROMPTS[2].text))
    }

    @Test fun `health entries under the person, body indented`() {
        val people = listOf(
            PackPerson(
                vova, emptyList(),
                health = listOf(
                    h("h1", "2026-05-01", HealthKind.LAB, "Lipid panel", "LDL 4.1 mmol/L (ref < 3.0)\nHDL 1.2 mmol/L"),
                    h("h2", "2026-04-20", HealthKind.SYMPTOM, "Aching hands in the morning", bodyPart = "hands", severity = 5, tags = listOf("arthritis")),
                ),
            ),
        )
        val pack = buildContextPack(PackOptions("Lipids?", people, realNames = false, year = 2026))
        assertTrue(
            pack.contains(
                "### Health log (the person's documents and self-reported symptoms, dated)\n- 2026-05-01 · Lab result · Lipid panel\n  LDL 4.1 mmol/L (ref < 3.0)\n  HDL 1.2 mmol/L\n- 2026-04-20 · Symptom · Aching hands in the morning (hands; severity 5/10; arthritis)",
            ),
        )
        assertEquals(2, packStats(people, pack).healthEntries)
    }

    @Test fun `compact pack folds a series and keeps one source`() {
        fun bp(id: String, date: String, v: Double, v2: Double, time: String = "") =
            h(id, date, HealthKind.MEASUREMENT, "Blood pressure", time = time, value = v, value2 = v2, unit = "mmHg")
        val people = listOf(
            PackPerson(
                vova, listOf(finding), genotypes = listOf(Call("rs999", "2", 42, "C", "T")),
                health = listOf(bp("b2", "2026-09-10", 124.0, 82.0, "08:05"), h("l1", "2026-09-05", HealthKind.LAB, "Lipid panel", "LDL 4.1 mmol/L\n\n  HDL 1.2"), bp("b1", "2026-09-01", 120.0, 80.0)),
            ),
        )
        val pack = buildContextPack(PackOptions("q", people, realNames = false, year = 2026, compact = true))
        assertTrue(
            pack.contains(
                listOf(
                    "Genotypes:",
                    "- CYP2C19 rs4244285 A/G: *1/*2 intermediate metaboliser [evidence A]",
                    "- rs999 C/T (chr2:42; not in knowledge base)",
                    "Health log:",
                    "- Blood pressure, mmHg (2 readings): 2026-09-01 120/80; 2026-09-10 08:05 124/82",
                    "- 2026-09-05 lab: Lipid panel — LDL 4.1 mmol/L; HDL 1.2",
                ).joinToString("\n"),
            ),
        )
        assertTrue(pack.contains("- CYP2C19*2: Loss-of-function allele. Sources: https://cpicpgx.org/x"))
        assertFalse(buildContextPack(PackOptions("q", listOf(PackPerson(vova, listOf(finding))), false, 2026, compact = true, evidence = false)).contains("Evidence notes"))
        assertEquals("a; b", squeeze("a\n b", 10))
        assertEquals("Once a day. After food", squeeze("Once a day.\nAfter food", 40))
        assertEquals("x".repeat(9) + "…", squeeze("x".repeat(20), 10))
    }

    private fun types(q: String, n: Int = 1) = classifyQuestion(q, kb, n).map { it.type }

    @Test fun `classifies questions like the web`() {
        assertEquals(Intent(QuestionType.MEDICATION, listOf("clopidogrel")), classifyQuestion("Is clopidogrel ok for me?", kb).first())
        assertEquals(listOf(QuestionType.LABS, QuestionType.GENETICS), types("My LDL cholesterol result is high, could it be genetic?"))
        assertEquals(listOf(QuestionType.SYMPTOMS, QuestionType.DOCTOR), types("Pain in both knees since Monday, should I see a doctor?"))
        assertEquals(listOf("dose", "prescribed"), classifyQuestion("what dose was prescribed", kb)[0].signals)
        assertEquals(listOf("side effect"), classifyQuestion("any side effects?", kb)[0].signals)
        assertEquals(listOf(QuestionType.GENETICS), types("what does rs12345 mean"))
        assertEquals(Intent(QuestionType.SYMPTOMS, listOf("back", "lower back")), classifyQuestion("my lower back", kb)[0])
        assertEquals(listOf(QuestionType.FAMILY, QuestionType.GENETICS), types("what about CYP2C19", 2))
        assertEquals(emptyList<Intent>(), classifyQuestion("hello there", kb))
        assertEquals(emptyList<Intent>(), classifyQuestion("in a moment, something general", kb))
    }

    @Test fun `retrieves kb entries for a question`() {
        assertEquals(listOf("rs12248560", "rs4244285"), retrieveForQuestion(kb, "Should Vova worry about clopidogrel given his CYP2C19 status? Compare with BVA.").sorted())
        assertTrue(retrieveForQuestion(kb, "is there anything about diabetes?").contains("rs7903146"))
        assertTrue(retrieveForQuestion(kb, "which statins are safe for me").contains("rs4149056"))
        assertEquals(emptyList<String>(), questionTerms("should I worry about this with my family"))
    }

    private val now = Instant.parse("2026-09-17T12:00:00Z")
    private val calls = listOf(Call("rs4244285", "10", 1, "A", "G"), Call("rs7903146", "10", 2, "C", "T"))
    private val findings = computeFindings(kb, calls)
    private val health = listOf(
        h("med1", "2026-08-01", HealthKind.MEDICATION, "Aspirin 100 mg", personId = "a"),
        h("lab1", "2025-01-01", HealthKind.LAB, "Lipid panel", personId = "a"),
        h("sym1", "2026-09-15", HealthKind.SYMPTOM, "Stiff hands", bodyPart = "hands", personId = "a"),
        h("sym-old", "2026-01-01", HealthKind.SYMPTOM, "Cold", personId = "a"),
        h("meas1", "2026-09-16", HealthKind.MEASUREMENT, "Blood pressure", personId = "a"),
    )
    private fun run(q: String, people: List<PersonRecords> = listOf(PersonRecords("a", findings, health))) =
        recommend(kb, q, classifyQuestion(q, kb, people.size), people, now)

    @Test fun `item keys round-trip`() {
        assertEquals(ParsedKey('f', "p1", "rs1"), parseKey(findingKey("p1", "rs1")))
        assertEquals(ParsedKey('g', "p1", "rs2"), parseKey(genotypeKey("p1", "rs2")))
        assertEquals(ParsedKey('h', "p1", "a:b"), parseKey(healthKey("p1", "a:b")))
        assertNull(parseKey("nope"))
    }

    @Test fun `recommends like the web`() {
        assertEquals(
            listOf("f:a:rs4244285" to Reason.Mentioned("CYP2C19"), "h:a:med1" to Reason.Recent(HealthKind.MEDICATION)),
            run("Is clopidogrel safe with my other medication?").map { it.key to it.reason },
        )
        val keys = run("my hands feel stiff").map { it.key }
        assertTrue("h:a:sym1" in keys && "h:a:meas1" in keys && "h:a:sym-old" !in keys && "h:a:lab1" !in keys)
        assertTrue("h:a:lab1" in run("explain my lab results").map { it.key })
        val family = listOf(PersonRecords("a", findings, emptyList()), PersonRecords("b", computeFindings(kb, listOf(calls[1])), emptyList()))
        assertEquals(listOf("f:a:rs7903146", "f:b:rs7903146"), run("who carries what", family).filter { it.reason == Reason.SharedVariant }.map { it.key })
        assertTrue(run("did the hands get better").any { it.key == "h:a:sym1" && it.reason is Reason.MatchesQuestion })
        assertEquals(emptyList<Suggestion>(), run("what is the plan").filter { it.reason is Reason.MatchesQuestion })
        assertEquals(emptyList<Suggestion>(), run("hello"))
    }

    @Test fun `resolves items and groups them by person`() {
        val f = Finding(KbEntry("rs1", "GENE", "n", "", "A", "", emptyMap(), emptyList(), emptyList(), emptyList(), "", ""), "AG", Call("rs1", "1", 1, "A", "G"), null, 0)
        fun e(id: String, date: String) = h(id, date, HealthKind.LAB, id, personId = "b")
        val data = AskData(mapOf("a" to listOf(f)), mapOf("b" to listOf(e("new", "2026-02-01"), e("old", "2025-01-01"))), mapOf("a" to mapOf("rs9" to Call("rs9", "3", 7, "T", "T"))))
        assertEquals("GENE rs1 A/G — undescribed", itemLabel(resolve("f:a:rs1", data)!!, "undescribed"))
        assertEquals("rs9 T/T (chr3:7)", itemLabel(resolve("g:a:rs9", data)!!, ""))
        assertNull(resolve("h:b:missing", data))
        fun person(id: String) = Person(id, id, id.uppercase(), "unknown", null, "", "")
        val people = packPeople(listOf("h:b:old", "g:a:rs9", "h:b:new", "f:a:rs1", "f:c:rs1"), data, listOf(person("a"), person("b"), person("c")), listOf("b", "a"))
        assertEquals(
            listOf(listOf("a", 1, 1, emptyList<String>()), listOf("b", 0, 0, listOf("new", "old"))),
            people.map { listOf(it.person.id, it.findings.size, it.genotypes.size, it.health.map { h -> h.id }) },
        )
    }
}
