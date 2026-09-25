import { conditionById, conditionNames } from '../kb/conditions'
import type { Kb, KbEntry } from '../kb/kb'
import { tokenMatch, tokens } from '../kb/text'

/**
 * Which knowledge-base entries a free-text question is about. Matches gene symbols, marker names,
 * rsids, drugs and conditions only — never summary prose, which contains every common word — and
 * ignores a stop list so "with", "about", "should" cannot pull in unrelated markers.
 */
const STOP = new Set(
  'the for you did has had was not his her him she who why its our out get got see use used now new too off own about above after again against all also and any are around because been before being below between both but can could does doing down during each even ever every from further have having here how into just like more most much need only other over same should since some such than that their them then there these they this those through under until very were what when where which while will with within without would your yours does dont should worry given compare status risk gene genes variant variants family member members mother father parent parents child children'.split(
    ' ',
  ),
)

export function questionTerms(question: string): string[] {
  return [...new Set(tokens(question).filter((w) => !STOP.has(w)))]
}

/** Marker names, drugs, and the names and synonyms of the conditions the marker is linked to. */
function entryTerms(kb: Kb, e: KbEntry): string[] {
  const conditions = (e.conditions ?? []).flatMap((id) => {
    const c = conditionById(kb, id)
    return c ? conditionNames(c) : [id]
  })
  return [e.rsid, e.gene, e.name, ...(e.drugs ?? []), ...conditions].flatMap(tokens)
}

export function retrieveForQuestion(kb: Kb, question: string): Set<string> {
  const terms = questionTerms(question)
  const hits = new Set<string>()
  if (terms.length === 0) return hits
  for (const e of kb.entries) {
    const et = entryTerms(kb, e)
    if (terms.some((t) => et.some((w) => tokenMatch(t, w)))) hits.add(e.rsid)
  }
  return hits
}
