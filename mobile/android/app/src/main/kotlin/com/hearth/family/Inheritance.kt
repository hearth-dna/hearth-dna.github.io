package com.hearth.family

import com.hearth.data.Call
import com.hearth.data.Person
import com.hearth.data.Relationship

/**
 * Per-rsid inheritance and the pedigree layout: a port of frontend/src/family/inheritance.ts. Pure;
 * the drawing lives in ui/Pedigree.kt.
 */

/** Where an allele came from: a parent id, or why none can be named. */
object Origin {
    const val AMBIGUOUS = "ambiguous"
    const val UNTYPED = "untyped"
    const val IMPOSSIBLE = "impossible"
}

data class AlleleOrigin(val allele: String, val from: String)

data class ParentCall(val id: String, val call: Call?)

private fun Call?.has(a: String) = this != null && (a1 == a || a2 == a)

/**
 * Phases a child's genotype against up to two parents. With two typed parents an allele is
 * attributed when exactly one parental assignment explains the pair (or the child is homozygous);
 * with one typed parent when the parent carries one allele and not the other. Everything else is
 * ambiguous; a pair no assignment explains is impossible (a Mendelian violation).
 */
fun alleleOrigins(child: Call, parents: List<ParentCall>): List<AlleleOrigin> {
    val c1 = child.a1
    val c2 = child.a2
    fun both(x: String, y: String) = listOf(AlleleOrigin(c1, x), AlleleOrigin(c2, y))
    if (c1 == "-" || c2 == "-") return emptyList()
    val typed = parents.filter { it.call != null && it.call.a1 != "-" }
    if (typed.isEmpty()) return both(Origin.UNTYPED, Origin.UNTYPED)
    if (typed.size == 1) {
        val p = typed[0]
        val other = parents.firstOrNull { it.id != p.id }?.id ?: Origin.UNTYPED
        val h1 = p.call.has(c1)
        val h2 = p.call.has(c2)
        return when {
            !h1 && !h2 -> both(Origin.IMPOSSIBLE, Origin.IMPOSSIBLE)
            c1 == c2 -> both(p.id, other)
            h1 && h2 -> both(Origin.AMBIGUOUS, Origin.AMBIGUOUS)
            h1 -> both(p.id, other)
            else -> both(other, p.id)
        }
    }
    val (a, b) = typed
    val ab = a.call.has(c1) && b.call.has(c2) // c1 from a, c2 from b
    val ba = a.call.has(c2) && b.call.has(c1) // c2 from a, c1 from b
    return when {
        !ab && !ba -> both(Origin.IMPOSSIBLE, Origin.IMPOSSIBLE)
        c1 == c2 || (ab && !ba) -> both(a.id, b.id)
        ba && !ab -> both(b.id, a.id)
        else -> both(Origin.AMBIGUOUS, Origin.AMBIGUOUS)
    }
}

/** One person's place in the drawing: row, slot within the row, and their parents' ids. */
data class PedigreeNode(val person: Person, val generation: Int, val column: Int, val parents: List<String>)

/**
 * Generation = longest ancestor chain (founders 0), then co-parents are pulled down to the same
 * row so a spouse who married in sits beside their partner rather than among the grandparents.
 * Within a generation people are ordered by the mean column of their parents (or of their
 * co-parent's parents), so children sit under them; ties keep creation order.
 */
fun layoutPedigree(persons: List<Person>, relationships: List<Relationship>): List<PedigreeNode> {
    val parentsOf = LinkedHashMap<String, List<String>>()
    for (r in relationships) parentsOf[r.childId] = (parentsOf[r.childId] ?: emptyList()) + r.parentId
    val gen = HashMap<String, Int>()
    fun depth(id: String, seen: MutableSet<String>): Int {
        gen[id]?.let { return it }
        if (!seen.add(id)) return 0 // cycle guard; the UI never creates one but a backup might
        val ps = parentsOf[id] ?: emptyList()
        val d = if (ps.isEmpty()) 0 else ps.maxOf { depth(it, seen) } + 1
        gen[id] = d
        return d
    }
    for (p in persons) depth(p.id, HashSet())
    val coParentsOf = LinkedHashMap<String, MutableSet<String>>()
    for (ps in parentsOf.values) for (a in ps) for (b in ps) if (a != b) coParentsOf.getOrPut(a) { LinkedHashSet() }.add(b)
    // Fixpoint: co-parents share a row, children stay below every parent. Bounded for cyclic backups.
    var changed = true
    var guard = persons.size * 2
    while (changed && guard-- > 0) {
        changed = false
        fun lift(id: String, to: Int) {
            if ((gen[id] ?: 0) < to) {
                gen[id] = to
                changed = true
            }
        }
        for ((a, bs) in coParentsOf) for (b in bs) lift(a, gen[b] ?: 0)
        for ((child, ps) in parentsOf) lift(child, ps.maxOf { gen[it] ?: 0 } + 1)
    }
    val col = HashMap<String, Int>()
    val byGeneration = persons.groupBy { gen[it.id] ?: 0 }
    val out = mutableListOf<PedigreeNode>()
    for (g in 0..(byGeneration.keys.maxOrNull() ?: 0)) {
        fun mean(ids: List<String>): Double {
            val cs = ids.mapNotNull { col[it] }
            return if (cs.isEmpty()) Double.POSITIVE_INFINITY else cs.average()
        }
        fun key(p: Person): Double {
            val own = mean(parentsOf[p.id] ?: emptyList())
            if (own != Double.POSITIVE_INFINITY) return own
            return mean((coParentsOf[p.id] ?: emptySet()).flatMap { parentsOf[it] ?: emptyList() })
        }
        val row = (byGeneration[g] ?: emptyList()).sortedWith(compareBy<Person> { key(it) }.thenBy { it.createdAt })
        row.forEachIndexed { i, p ->
            col[p.id] = i
            out.add(PedigreeNode(p, g, i, parentsOf[p.id] ?: emptyList()))
        }
    }
    // The caller's order, as the web returns it.
    val index = persons.withIndex().associate { it.value.id to it.index }
    return out.sortedBy { index[it.person.id] }
}
