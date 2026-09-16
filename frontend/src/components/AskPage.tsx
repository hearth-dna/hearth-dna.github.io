import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { buildContextPack, packStats } from '../ask/contextPack'
import { PROMPTS } from '../ask/prompts'
import { retrieveForQuestion } from '../ask/retrieve'
import { listHealthLog, logSharing, newId, now, personCallsFor } from '../db/repo'
import { describeEntry } from '../health/log'
import { rich, useT } from '../i18n/context'
import { computeFindings, type Finding } from '../kb/kb'
import type { HealthEntry } from '../types'

/**
 * Ask, tiers 0 and 2 (docs/design.md §6.3): local retrieval builds a context pack; the user
 * previews it, removes items, and copies it into whichever assistant they trust. Nothing is sent
 * by the app. Every copy is confirmed and recorded in the sharing log.
 */
export function AskPage() {
  const { db, kb, persons } = useApp()
  const t = useT()
  const [question, setQuestion] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [findingsBy, setFindingsBy] = useState<Record<string, Finding[]>>({})
  const [healthBy, setHealthBy] = useState<Record<string, HealthEntry[]>>({})
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [realNames, setRealNames] = useState(false)
  const [templateId, setTemplateId] = useState(PROMPTS[0].id)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const out: Record<string, Finding[]> = {}
      const health: Record<string, HealthEntry[]> = {}
      for (const id of selected) {
        if (!findingsBy[id])
          out[id] = computeFindings(
            kb,
            await personCallsFor(
              db,
              id,
              kb.entries.map((e) => e.rsid),
            ),
          )
        if (!healthBy[id]) health[id] = await listHealthLog(db, id)
      }
      if (Object.keys(out).length) setFindingsBy((prev) => ({ ...prev, ...out }))
      if (Object.keys(health).length) setHealthBy((prev) => ({ ...prev, ...health }))
    })()
  }, [selected, db, kb, findingsBy, healthBy])

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
    // The whole health log is offered; entries are removed per item like genotypes.
    const health = (healthBy[id] ?? []).filter((h) => !excluded.has(`${id}:${h.id}`))
    return { person, findings, health }
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
      <h1>{t('askPage.title')}</h1>
      <p className="muted">{t('askPage.intro')}</p>
      <div className="card">
        <label className="field">
          {t('askPage.question')}
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('askPage.questionPlaceholder')}
          />
        </label>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <span>{t('askPage.people')}</span>
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
            {t('askPage.promptTemplate')}
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {PROMPTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.titleKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="check" style={{ margin: 0 }}>
            <input type="checkbox" checked={realNames} onChange={(e) => setRealNames(e.target.checked)} />
            <span>{t('askPage.realNames')}</span>
          </label>
        </div>
      </div>

      <div className="card">
        <h2>
          {t('askPage.includedHeading')}{' '}
          <span className="muted">
            {t('askPage.includedStats', {
              genotypes: stats.genotypes,
              healthEntries: stats.healthEntries,
              people: people.length,
            })}
          </span>
        </h2>
        {relevantRsids.size === 0 && question.trim() && <p className="muted">{t('askPage.noMatch')}</p>}
        {!realNames && namesInQuestion.length > 0 && (
          <p className="warn">{t('askPage.namesWarning', { names: namesInQuestion.join(', ') })}</p>
        )}
        {people.map(({ person, findings, health }) => (
          <div key={person.id}>
            <h3>{person.displayName}</h3>
            {health.length > 0 && (
              <ul>
                {health.map((h) => (
                  <li key={h.id}>
                    {describeEntry(h)}{' '}
                    <button
                      type="button"
                      onClick={() => setExcluded(new Set([...excluded, `${person.id}:${h.id}`]))}
                    >
                      {t('askPage.remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {findings.length === 0 ? (
              <p className="muted">{t('askPage.nothingSelected')}</p>
            ) : (
              <ul>
                {findings.map((f) => (
                  <li key={f.entry.rsid}>
                    {f.entry.gene} {f.entry.rsid} {f.call.a1}/{f.call.a2} —{' '}
                    {f.match?.label ?? t('askPage.undescribed')}{' '}
                    <button
                      type="button"
                      onClick={() => setExcluded(new Set([...excluded, `${person.id}:${f.entry.rsid}`]))}
                    >
                      {t('askPage.remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {excluded.size > 0 && (
          <button type="button" onClick={() => setExcluded(new Set())}>
            {t('askPage.restoreRemoved', { n: excluded.size })}
          </button>
        )}
      </div>

      <div className="card">
        <h2>{t('askPage.previewHeading', { chars: stats.chars.toLocaleString() })}</h2>
        <pre className="pack">{pack}</pre>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={selected.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            {t('askPage.copyButton')}
          </button>
          {copied && <span className="ok">{t('askPage.copied', { destination: copied })}</span>}
        </div>
        <p className="muted">
          {rich(t('askPage.openAssistant'), {
            chatgpt: (c) => (
              <a href="https://chatgpt.com" target="_blank" rel="noreferrer">
                {c}
              </a>
            ),
            claude: (c) => (
              <a href="https://claude.ai" target="_blank" rel="noreferrer">
                {c}
              </a>
            ),
            gemini: (c) => (
              <a href="https://gemini.google.com" target="_blank" rel="noreferrer">
                {c}
              </a>
            ),
          })}
        </p>
      </div>

      {confirmOpen && (
        <dialog open>
          <h2 style={{ marginTop: 0 }}>{t('askPage.confirmTitle')}</h2>
          <p>{rich(t('askPage.confirmBody'))}</p>
          <ul>
            <li>
              {t('askPage.confirmCounts', {
                genotypes: stats.genotypes,
                healthEntries: stats.healthEntries,
                people: people.length,
                peopleWord: people.length === 1 ? t('askPage.person') : t('askPage.peopleWord'),
                naming: realNames ? t('askPage.withRealNames') : t('askPage.pseudonymised'),
              })}
            </li>
            <li>{t('askPage.confirmLogged')}</li>
          </ul>
          <div className="row">
            <button type="button" className="primary" onClick={() => copy('clipboard')}>
              {t('askPage.confirmCopy')}
            </button>
            <button type="button" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </dialog>
      )}
    </div>
  )
}
