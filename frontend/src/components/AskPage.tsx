import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { buildContextPack, packStats } from '../ask/contextPack'
import { PROMPTS } from '../ask/prompts'
import { retrieveForQuestion } from '../ask/retrieve'
import { logSharing, newId, now, personCallsFor } from '../db/repo'
import { computeFindings, type Finding } from '../kb/kb'

/**
 * Ask, tiers 0 and 2 (docs/design.md §6.3): local retrieval builds a context pack; the user
 * previews it, removes items, and copies it into whichever assistant they trust. Nothing is sent
 * by the app. Every copy is confirmed and recorded in the sharing log.
 */
export function AskPage() {
  const { db, kb, persons } = useApp()
  const [question, setQuestion] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [findingsBy, setFindingsBy] = useState<Record<string, Finding[]>>({})
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [realNames, setRealNames] = useState(false)
  const [templateId, setTemplateId] = useState(PROMPTS[0].id)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const out: Record<string, Finding[]> = {}
      for (const id of selected)
        if (!findingsBy[id])
          out[id] = computeFindings(
            kb,
            await personCallsFor(
              db,
              id,
              kb.entries.map((e) => e.rsid),
            ),
          )
      if (Object.keys(out).length) setFindingsBy((prev) => ({ ...prev, ...out }))
    })()
  }, [selected, db, kb, findingsBy])

  // Retrieval: kb entries whose gene/marker/drug/condition names appear in the question; fall
  // back to all findings with magnitude ≥ 2 when the question matches nothing specific.
  const relevantRsids = useMemo(() => retrieveForQuestion(kb, question), [question, kb])
  const namesInQuestion = persons
    .filter((p) => selected.includes(p.id) && question.toLowerCase().includes(p.displayName.toLowerCase()))
    .map((p) => p.displayName)

  const people = selected.map((id) => {
    const person = persons.find((p) => p.id === id)!
    const all = findingsBy[id] ?? []
    const findings = (
      relevantRsids.size
        ? all.filter((f) => relevantRsids.has(f.entry.rsid))
        : all.filter((f) => (f.match?.magnitude ?? 0) >= 2)
    ).filter((f) => !excluded.has(`${id}:${f.entry.rsid}`))
    return { person, findings }
  })
  const template = PROMPTS.find((p) => p.id === templateId)
  const pack = buildContextPack({ question, people, realNames, template })
  const stats = packStats(pack)

  const copy = async (destination: string) => {
    await navigator.clipboard.writeText(pack)
    await logSharing(db, 'copy-out', destination, pack)
    await db.exec(
      'INSERT INTO chat(id,person_ids,question,context_pack,tier,created_at) VALUES (?,?,?,?,?,?)',
      [newId(), selected.join(','), question, pack, 'copy-out', now()],
    )
    setConfirmOpen(false)
    setCopied(destination)
  }

  return (
    <div>
      <h1>Ask</h1>
      <p className="muted">
        Build a context pack from the family's genotypes, then paste it into ChatGPT, Claude, Gemini or any
        assistant you already use. Hearth sends nothing itself. Names are replaced by labels unless you switch
        them on.
      </p>
      <div className="card">
        <label className="field">
          Your question
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Should Vova worry about clopidogrel? · Who inherited the TCF7L2 diabetes variant? · Is simvastatin a good choice for Polina?"
          />
        </label>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <span>People:</span>
          {persons.map((p) => (
            <label className="check" key={p.id} style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) =>
                  setSelected(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))
                }
              />
              <span>{p.displayName}</span>
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <label className="field">
            Prompt template
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {PROMPTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label className="check" style={{ margin: 0 }}>
            <input type="checkbox" checked={realNames} onChange={(e) => setRealNames(e.target.checked)} />
            <span>include real names and exact ages</span>
          </label>
        </div>
      </div>

      <div className="card">
        <h2>
          Included genotypes{' '}
          <span className="muted">
            ({stats.genotypes} across {people.length} people)
          </span>
        </h2>
        {relevantRsids.size === 0 && question.trim() && (
          <p className="muted">
            No knowledge-base entry matches a word in the question; showing markers with impact ≥ 2 instead.
          </p>
        )}
        {!realNames && namesInQuestion.length > 0 && (
          <p className="warn">
            Your question mentions {namesInQuestion.join(', ')} by name; the pack labels people as Person A/B.
            Reword the question or switch real names on.
          </p>
        )}
        {people.map(({ person, findings }) => (
          <div key={person.id}>
            <h3>{person.displayName}</h3>
            {findings.length === 0 ? (
              <p className="muted">nothing selected</p>
            ) : (
              <ul>
                {findings.map((f) => (
                  <li key={f.entry.rsid}>
                    {f.entry.gene} {f.entry.rsid} {f.call.a1}/{f.call.a2} — {f.match?.label ?? 'undescribed'}{' '}
                    <button
                      type="button"
                      onClick={() => setExcluded(new Set([...excluded, `${person.id}:${f.entry.rsid}`]))}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {excluded.size > 0 && (
          <button type="button" onClick={() => setExcluded(new Set())}>
            restore removed ({excluded.size})
          </button>
        )}
      </div>

      <div className="card">
        <h2>Preview — exactly what will be copied ({stats.chars.toLocaleString()} characters)</h2>
        <pre className="pack">{pack}</pre>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={selected.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Copy context pack…
          </button>
          {copied && <span className="ok">Copied for {copied}. Now paste it into the assistant.</span>}
        </div>
        <p className="muted">
          Open the assistant yourself:{' '}
          <a href="https://chatgpt.com" target="_blank" rel="noreferrer">
            ChatGPT
          </a>{' '}
          ·{' '}
          <a href="https://claude.ai" target="_blank" rel="noreferrer">
            Claude
          </a>{' '}
          ·{' '}
          <a href="https://gemini.google.com" target="_blank" rel="noreferrer">
            Gemini
          </a>
          . These links carry no data. Consumer chat accounts may use conversations for training unless you
          turn that off in the provider's settings; consider doing so before pasting health information.
        </p>
      </div>

      {confirmOpen && (
        <dialog open>
          <h2 style={{ marginTop: 0 }}>Before you copy</h2>
          <p>
            The text in the preview will be placed on your clipboard. Once pasted into a third-party service
            it is governed by <em>their</em> terms and privacy policy, not Hearth's.
          </p>
          <ul>
            <li>
              {stats.genotypes} genotypes for {people.length} {people.length === 1 ? 'person' : 'people'},{' '}
              {realNames ? 'with real names' : 'pseudonymised'}
            </li>
            <li>Recorded in the sharing log (Settings) so you can audit what left this device</li>
          </ul>
          <div className="row">
            <button type="button" className="primary" onClick={() => copy('clipboard')}>
              I have checked the preview — copy
            </button>
            <button type="button" onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
          </div>
        </dialog>
      )}
    </div>
  )
}
