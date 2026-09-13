import type { Kb, KbEntry } from '../kb/kb'

/**
 * Which knowledge-base entries a free-text question is about. Matches gene symbols, marker names,
 * rsids, drugs and conditions only — never summary prose, which contains every common word — and
 * ignores a stop list so "with", "about", "should" cannot pull in unrelated markers.
 */
const STOP = new Set(
  'about above after again against all also and any are around because been before being below between both but can could does doing down during each even ever every from further have having here how into just like more most much need only other over same should since some such than that their them then there these they this those through under until very were what when where which while will with within without would your yours does dont should worry given compare status risk gene genes variant variants family member members mother father parent parents child children'.split(
    ' ',
  ),
)

export function questionTerms(question: string): string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9*]+/)
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  ]
}

function entryTerms(e: KbEntry): string[] {
  return [e.rsid, e.gene, e.name, ...(e.drugs ?? []), ...(e.conditions ?? [])]
    .flatMap((s) => s.toLowerCase().split(/[^a-z0-9*]+/))
    .filter((w) => w.length >= 3)
}

export function retrieveForQuestion(kb: Kb, question: string): Set<string> {
  const terms = questionTerms(question)
  const hits = new Set<string>()
  if (terms.length === 0) return hits
  for (const e of kb.entries) {
    const et = entryTerms(e)
    // Whole-token match, or a question term that is a prefix of a token ≥ 5 chars (statin → statins, diabet → diabetes).
    if (
      terms.some((t) =>
        et.some((w) => w === t || (t.length >= 5 && w.startsWith(t)) || (w.length >= 5 && t.startsWith(w))),
      )
    )
      hits.add(e.rsid)
  }
  return hits
}
