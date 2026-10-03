package com.hearth.family

import com.hearth.data.Call
import com.hearth.data.Person
import com.hearth.data.Relationship
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors frontend/src/family/inheritance.test.ts. */
class InheritanceTest {
    private fun c(g: String) = Call("rs1", "1", 1, g.substring(0, 1), g.substring(1, 2))
    private fun from(child: String, mum: String? = null, dad: String? = null) =
        alleleOrigins(c(child), listOf(ParentCall("mum", mum?.let(::c)), ParentCall("dad", dad?.let(::c)))).map { it.from }

    @Test fun phases() {
        assertEquals(listOf("mum", "dad"), from("AG", "AA", "GG"))
        assertEquals(listOf("dad", "mum"), from("GA", "AA", "GG"))
        assertEquals(listOf("mum", "dad"), from("AG", "AG", "GG"))
        assertEquals(listOf("mum", "dad"), from("AA", "AG", "AG"))
        assertEquals(listOf("ambiguous", "ambiguous"), from("AG", "AG", "AG"))
    }

    @Test fun `flags impossible pairs`() {
        assertEquals(listOf("impossible", "impossible"), from("AA", "GG", "AG"))
        assertEquals(listOf("impossible", "impossible"), from("TT", "CC"))
    }

    @Test fun `handles one typed parent`() {
        assertEquals(listOf("mum", "dad"), from("AG", "AA"))
        assertEquals(listOf("mum", "dad"), from("AG", null, "GG"))
        assertEquals(listOf("ambiguous", "ambiguous"), from("AG", "AG"))
        assertEquals(listOf("mum", "dad"), from("AA", "AG"))
    }

    @Test fun `no-calls and untyped parents`() {
        assertEquals(emptyList<String>(), from("A-", "AA", "GG"))
        assertEquals(listOf("untyped", "untyped"), from("AG"))
    }

    private fun p(id: String, createdAt: String) = Person(id, id, id, "unknown", null, "", createdAt)

    @Test fun `founders on top, co-parents side by side, children under them`() {
        val nodes = layoutPedigree(
            listOf(p("kid", "3"), p("gran", "0"), p("mum", "1"), p("dad", "2"), p("uncle", "4")),
            listOf(Relationship("gran", "mum"), Relationship("gran", "uncle"), Relationship("mum", "kid"), Relationship("dad", "kid")),
        )
        fun at(id: String) = nodes.first { it.person.id == id }
        assertEquals(listOf(0, 1, 1, 2), listOf(at("gran").generation, at("dad").generation, at("mum").generation, at("kid").generation))
        assertTrue(at("mum").column < at("uncle").column)
        assertEquals(1, Math.abs(at("dad").column - at("mum").column))
        assertEquals(listOf("dad", "mum"), at("kid").parents.sorted())
    }

    @Test fun `keeps a child below a parent pulled down to a co-parent`() {
        val nodes = layoutPedigree(
            listOf(p("gran", "0"), p("mum", "1"), p("dad", "2"), p("kid", "3"), p("step", "4"), p("half", "5")),
            listOf(
                Relationship("gran", "mum"), Relationship("mum", "kid"), Relationship("dad", "kid"),
                Relationship("dad", "half"), Relationship("step", "half"),
            ),
        )
        fun at(id: String) = nodes.first { it.person.id == id }
        assertEquals(listOf(1, 2), listOf(at("step").generation, at("half").generation))
    }
}
