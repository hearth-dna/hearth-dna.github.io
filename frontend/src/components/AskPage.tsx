import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { buildContextPack, packStats } from '../ask/contextPack'
import { classifyQuestion, TEMPLATE_FOR } from '../ask/intent'
import { type AskData, itemLabel, packPeople, resolve } from '../ask/items'
import { PROMPTS } from '../ask/prompts'
import { type ItemKey, parseKey, recommend } from '../ask/recommend'
import { listHealthLog, logSharing, newId, now, personCallsFor } from '../db/repo'
import { rich, useT } from '../i18n/context'
import { computeFindings } from '../kb/kb'
import type { Call } from '../types'
import { AskSearch } from './AskSearch'
import { AskSuggestions } from './AskSuggestions'

/**
 * Ask, tiers 0 and 2 (docs/design.md §6.3). The question is classified locally (medication, labs,
 * symptoms…), which picks a prompt template and suggests records; the user can also search the
 * health log and DNA for anything else. Only records the user includes go into the pack, which is
 * previewed exactly as copied. Nothing is sent by the app; every copy is confirmed and logged.
 */
export function AskPage() {
  const { db, kb, persons } = useApp()
  const t = useT()
  const [question, setQuestion] = useState('')
  const [selected, setSelected] = useState<string[]>(() => (persons.length === 1 ? [persons[0].id] : []))
  const [data, setData] = useState<AskData>({ findingsBy: {}, healthBy: {}, rawBy: {} })
  const [included, setIncluded] = useState<ItemKey[]>([])
  const [realNames, setRealNames] = useState(false)
  const [compact, setCompact] = useState(true)
  const [evidence, setEvidence] = useState(true)
  const [templateId, setTemplateId] = useState(PROMPTS[0].id)
  const [templateChosen, setTemplateChosen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  // Load kb findings and the health log once per selected person.
  useEffect(() => {
    let live = true
    ;(async () => {
      for (const id of selected) {
        if (data.findingsBy[id] && data.healthBy[id]) continue
        const [calls, health] = await Promise.all([
          personCallsFor(
            db,
            id,
            kb.entries.map((e) => e.rsid),
          ),
          listHealthLog(db, id),
        ])
        if (!live) return
        setData((d) => ({
          ...d,
          findingsBy: { ...d.findingsBy, [id]: computeFindings(kb, calls) },
          healthBy: { ...d.healthBy, [id]: health },
        }))
      }
    })()
    return () => {
      live = false
    }
  }, [selected, db, kb, data.findingsBy, data.healthBy])

  const people = persons.filter((p) => selected.includes(p.id))
  const intents = useMemo(
    () => classifyQuestion(question, kb, selected.length),
    [question, kb, selected.length],
  )
  const suggestions = useMemo(
    () =>
      recommend(
        kb,
        question,
        intents,
        selected
          .filter((id) => data.findingsBy[id])
          .map((id) => ({ personId: id, findings: data.findingsBy[id], health: data.healthBy[id] ?? [] })),
      ),
    [kb, question, intents, selected, data],
  )

  // Follow the question's type until the user picks a template themselves.
  useEffect(() => {
    if (!templateChosen && intents[0]) setTemplateId(TEMPLATE_FOR[intents[0].type])
  }, [intents, templateChosen])

  const lower = question.toLowerCase()
  const named = persons.filter(
    (p) => p.displayName.length >= 2 && new RegExp(`\\b${p.displayName.toLowerCase()}\\b`, 'u').test(lower),
  )
  const mentioned = named.filter((p) => !selected.includes(p.id))
  const includedSet = new Set(included)
  const toggle = (key: ItemKey) =>
    setIncluded((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))
  const setPerson = (id: string, on: boolean) => {
    setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)))
    if (!on) setIncluded((keys) => keys.filter((k) => parseKey(k)?.personId !== id))
  }
  const addRaw = (personId: string, calls: Call[]) =>
    calls.length &&
    setData((d) => ({
      ...d,
      rawBy: {
        ...d.rawBy,
        [personId]: { ...d.rawBy[personId], ...Object.fromEntries(calls.map((c) => [c.rsid, c])) },
      },
    }))

  const packed = packPeople(included, data, persons, selected)
  const template = PROMPTS.find((p) => p.id === templateId)
  const options = { question, people: packed, realNames, template, compact, evidence }
  const pack = buildContextPack(options)
  const stats = packStats(options, pack)

  const copy = async (destination: string) => {
    await navigator.clipboard.writeText(pack)
    await logSharing(db, 'copy-out', destination, pack)
    await db.exec(
      'INSERT INTO chat(id,person_ids,question,context_pack,tier,created_at) VALUES (?,?,?,?,?,?)',
      [newId(), packed.map((p) => p.person.id).join(','), question, pack, 'copy-out', now()],
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
        <div className="row mt-3">
          <span>{t('askPage.people')}</span>
          {persons.map((p) => (
            <label className="check m-0" key={p.id}>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) => setPerson(p.id, e.target.checked)}
              />
              <span>{p.displayName}</span>
            </label>
          ))}
        </div>
      </div>

      <AskSuggestions
        intents={intents}
        templateId={templateId}
        onTemplate={(id) => {
          setTemplateId(id)
          setTemplateChosen(true)
        }}
        mentioned={mentioned}
        onSelectPerson={(id) => setPerson(id, true)}
        suggestions={suggestions}
        data={data}
        people={people}
        included={includedSet}
        onToggle={toggle}
      />

      {people.length > 0 && (
        <AskSearch people={people} data={data} included={includedSet} onToggle={toggle} onRaw={addRaw} />
      )}

      <div className="card">
        <div className="card-head">
          <h2>
            {t('askPage.includedHeading')}{' '}
            <span className="muted">
              {t('askPage.includedStats', {
                genotypes: stats.genotypes,
                healthEntries: stats.healthEntries,
                people: packed.length,
              })}
            </span>
          </h2>
          {included.length > 0 && (
            <button type="button" className="small" onClick={() => setIncluded([])}>
              {t('askPage.removeAll')}
            </button>
          )}
        </div>
        {packed.length === 0 ? (
          <p className="muted">{t('askPage.nothingIncluded')}</p>
        ) : (
          packed.map((pp) => (
            <div key={pp.person.id}>
              <h3>{pp.person.displayName}</h3>
              <ul className="picklist">
                {included
                  .map((k) => resolve(k, data))
                  .filter((r) => r && r.personId === pp.person.id)
                  .map(
                    (r) =>
                      r && (
                        <li key={r.key}>
                          <button type="button" className="small" onClick={() => toggle(r.key)}>
                            {t('askPage.remove')}
                          </button>
                          <span>{itemLabel(r, t('askPage.undescribed'))}</span>
                        </li>
                      ),
                  )}
              </ul>
            </div>
          ))
        )}
        <div className="row mt-3">
          <label className="field">
            {t('askPage.promptTemplate')}
            <select
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value)
                setTemplateChosen(true)
              }}
            >
              {PROMPTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.titleKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="check m-0">
            <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
            <span>{t('askPage.compact')}</span>
          </label>
          <label className="check m-0">
            <input type="checkbox" checked={evidence} onChange={(e) => setEvidence(e.target.checked)} />
            <span>{t('askPage.evidenceNotes')}</span>
          </label>
          <label className="check m-0">
            <input type="checkbox" checked={realNames} onChange={(e) => setRealNames(e.target.checked)} />
            <span>{t('askPage.realNames')}</span>
          </label>
        </div>
        {!realNames && named.length > 0 && (
          <p className="warn">
            {t('askPage.namesWarning', { names: named.map((p) => p.displayName).join(', ') })}
          </p>
        )}
      </div>

      <div className="card">
        <h2>
          {t('askPage.previewHeading', {
            chars: stats.chars.toLocaleString(),
            tokens: stats.tokens.toLocaleString(),
          })}
        </h2>
        <pre className="pack">{pack}</pre>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={packed.length === 0}
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
          <h2 className="mt-0">{t('askPage.confirmTitle')}</h2>
          <p>{rich(t('askPage.confirmBody'))}</p>
          <ul>
            <li>
              {t('askPage.confirmCounts', {
                genotypes: stats.genotypes,
                healthEntries: stats.healthEntries,
                people: packed.length,
                peopleWord: packed.length === 1 ? t('askPage.person') : t('askPage.peopleWord'),
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
