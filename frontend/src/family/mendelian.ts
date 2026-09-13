import type { Call } from '../types'

/**
 * Mendelian consistency between a child and one or two parents over shared autosomal SNPs.
 * Same computation as family_dna's COVERAGE.md audit: violation = the child carries an allele
 * neither parent could have given, or (with two parents) no parental assignment explains the pair.
 * Unrelated adults show ~5–8% violations on consumer chips; true parent–child < 0.1%.
 */
export interface MendelianResult {
  compared: number
  violations: number
  rate: number
}

const AUTOSOMES = new Set(Array.from({ length: 22 }, (_, i) => String(i + 1)))

function alleles(c: Call): string[] {
  return [c.a1, c.a2].filter((a) => a !== '-')
}

export function mendelianCheck(
  child: Map<string, Call>,
  parentA: Map<string, Call>,
  parentB?: Map<string, Call>,
): MendelianResult {
  let compared = 0
  let violations = 0
  for (const [rsid, c] of child) {
    if (!AUTOSOMES.has(c.chromosome)) continue
    const pa = parentA.get(rsid)
    if (!pa) continue
    const ca = alleles(c)
    const aa = alleles(pa)
    if (ca.length !== 2 || aa.length !== 2) continue
    if (parentB) {
      const pb = parentB.get(rsid)
      if (!pb) continue
      const ba = alleles(pb)
      if (ba.length !== 2) continue
      compared++
      const ok = (aa.includes(ca[0]) && ba.includes(ca[1])) || (aa.includes(ca[1]) && ba.includes(ca[0]))
      if (!ok) violations++
    } else {
      compared++
      if (!aa.includes(ca[0]) && !aa.includes(ca[1])) violations++
    }
  }
  return { compared, violations, rate: compared ? violations / compared : 0 }
}

export function toMap(calls: Call[]): Map<string, Call> {
  return new Map(calls.map((c) => [c.rsid, c]))
}

/** Fraction of shared SNPs where two people carry identical genotypes (a crude relatedness hint). */
export function sharedGenotypeRate(
  a: Map<string, Call>,
  b: Map<string, Call>,
): { compared: number; identical: number } {
  let compared = 0
  let identical = 0
  for (const [rsid, ca] of a) {
    const cb = b.get(rsid)
    if (!cb || !AUTOSOMES.has(ca.chromosome)) continue
    compared++
    const x = [ca.a1, ca.a2].sort().join('')
    const y = [cb.a1, cb.a2].sort().join('')
    if (x === y) identical++
  }
  return { compared, identical }
}
