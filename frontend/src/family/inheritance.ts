import type { Call, Person } from '../types'

/**
 * Per-rsid inheritance: which parent each of a child's alleles came from, and a generation layout
 * of the pedigree for drawing. Pure; the SVG lives in components/InheritanceTree.tsx.
 */

export type Origin = string | 'ambiguous' | 'untyped' | 'impossible'

export interface AlleleOrigin {
  allele: string
  /** parent id, or why it cannot be named */
  from: Origin
}

const has = (c: Call | undefined, a: string) => !!c && (c.a1 === a || c.a2 === a)

/**
 * Phases a child's genotype against up to two parents. With two typed parents an allele is
 * attributed when exactly one parental assignment explains the pair (or the child is homozygous);
 * with one typed parent when the parent carries one allele and not the other. Everything else is
 * 'ambiguous'; a pair no assignment explains is 'impossible' (a Mendelian violation).
 */
export function alleleOrigins(child: Call, parents: { id: string; call?: Call }[]): AlleleOrigin[] {
  const [c1, c2] = [child.a1, child.a2]
  if (c1 === '-' || c2 === '-') return []
  const typed = parents.filter((p) => p.call && p.call.a1 !== '-')
  if (typed.length === 0)
    return [
      { allele: c1, from: 'untyped' },
      { allele: c2, from: 'untyped' },
    ]
  if (typed.length === 1) {
    const p = typed[0]
    const other = parents.find((q) => q.id !== p.id)?.id ?? 'untyped'
    const h1 = has(p.call, c1)
    const h2 = has(p.call, c2)
    if (!h1 && !h2)
      return [
        { allele: c1, from: 'impossible' },
        { allele: c2, from: 'impossible' },
      ]
    if (c1 === c2)
      return [
        { allele: c1, from: p.id },
        { allele: c2, from: other },
      ]
    if (h1 && h2)
      return [
        { allele: c1, from: 'ambiguous' },
        { allele: c2, from: 'ambiguous' },
      ]
    return h1
      ? [
          { allele: c1, from: p.id },
          { allele: c2, from: other },
        ]
      : [
          { allele: c1, from: other },
          { allele: c2, from: p.id },
        ]
  }
  const [a, b] = typed
  const ab = has(a.call, c1) && has(b.call, c2) // c1 from a, c2 from b
  const ba = has(a.call, c2) && has(b.call, c1) // c2 from a, c1 from b
  if (!ab && !ba)
    return [
      { allele: c1, from: 'impossible' },
      { allele: c2, from: 'impossible' },
    ]
  if (c1 === c2 || (ab && !ba))
    return [
      { allele: c1, from: a.id },
      { allele: c2, from: b.id },
    ]
  if (ba && !ab)
    return [
      { allele: c1, from: b.id },
      { allele: c2, from: a.id },
    ]
  return [
    { allele: c1, from: 'ambiguous' },
    { allele: c2, from: 'ambiguous' },
  ]
}

export interface PedigreeNode {
  person: Person
  generation: number
  /** 0-based slot within the generation, ordered under the parents */
  column: number
  parents: string[]
}

/**
 * Generation = longest ancestor chain (founders 0), then co-parents are pulled down to the same
 * row so a spouse who married in sits beside their partner rather than among the grandparents.
 * Within a generation people are ordered by the mean column of their parents (or of their
 * co-parent's parents), so children sit under them; ties keep creation order.
 */
export function layoutPedigree(
  persons: Person[],
  relationships: { parentId: string; childId: string }[],
): PedigreeNode[] {
  const parentsOf = new Map<string, string[]>()
  for (const r of relationships) parentsOf.set(r.childId, [...(parentsOf.get(r.childId) ?? []), r.parentId])
  const gen = new Map<string, number>()
  const depth = (id: string, seen: Set<string>): number => {
    const g = gen.get(id)
    if (g !== undefined) return g
    if (seen.has(id)) return 0 // cycle guard; the UI never creates one but a dump might
    seen.add(id)
    const ps = parentsOf.get(id) ?? []
    const d = ps.length ? Math.max(...ps.map((p) => depth(p, seen))) + 1 : 0
    gen.set(id, d)
    return d
  }
  for (const p of persons) depth(p.id, new Set())
  const coParentsOf = new Map<string, Set<string>>()
  for (const ps of parentsOf.values())
    for (const a of ps)
      for (const b of ps) if (a !== b) coParentsOf.set(a, new Set(coParentsOf.get(a)).add(b))
  // Fixpoint: co-parents share a row, children stay below every parent. Bounded for cyclic dumps.
  for (let changed = true, guard = persons.length * 2; changed && guard > 0; guard--) {
    changed = false
    const lift = (id: string, to: number) => {
      if ((gen.get(id) ?? 0) < to) {
        gen.set(id, to)
        changed = true
      }
    }
    for (const [a, bs] of coParentsOf) for (const b of bs) lift(a, gen.get(b) ?? 0)
    for (const [child, ps] of parentsOf) lift(child, Math.max(...ps.map((q) => gen.get(q) ?? 0)) + 1)
  }
  const nodes: PedigreeNode[] = persons.map((person) => ({
    person,
    generation: gen.get(person.id) ?? 0,
    column: 0,
    parents: parentsOf.get(person.id) ?? [],
  }))
  const col = new Map<string, number>()
  const maxGen = Math.max(0, ...nodes.map((n) => n.generation))
  for (let g = 0; g <= maxGen; g++) {
    const row = nodes.filter((n) => n.generation === g)
    const mean = (ids: string[]) => {
      const cs = ids.map((p) => col.get(p)).filter((c): c is number => c !== undefined)
      return cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : Number.POSITIVE_INFINITY
    }
    const key = (n: PedigreeNode) => {
      const own = mean(n.parents)
      if (own !== Number.POSITIVE_INFINITY) return own
      const inLaws = [...(coParentsOf.get(n.person.id) ?? [])].flatMap((c) => parentsOf.get(c) ?? [])
      return mean(inLaws)
    }
    row.sort((a, b) => key(a) - key(b) || a.person.createdAt.localeCompare(b.person.createdAt))
    row.forEach((n, i) => {
      n.column = i
      col.set(n.person.id, i)
    })
  }
  return nodes
}
