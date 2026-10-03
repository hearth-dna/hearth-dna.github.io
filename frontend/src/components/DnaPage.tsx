import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { buildContextPack, packStats } from '../ask/contextPack'
import { PROMPTS } from '../ask/prompts'
import { personCallsFor } from '../db/repo'
import { useI18n, useT } from '../i18n/context'
import { computeFindings, type Finding } from '../kb/kb'
import {
  areaName,
  NO_VIEWER_FILTER,
  type ViewerFilter,
  viewerPackPeople,
  viewerQuestion,
  viewerRows,
} from '../kb/viewer'
import { PackPreview } from './PackPreview'

const EXPLAIN = PROMPTS.find((p) => p.id === 'explain')

/**
 * The DNA viewer (`/dna`, `/dna/<person>`): every marker the knowledge base describes, most
 * clinically useful first, with each person's genotype beside it. Filter by person, area of
 * medicine, text and notability; what is shown, or only the markers ticked, becomes a context
 * pack to copy, share or open in an assistant, previewed exactly as it leaves.
 */
export function DnaPage({ person: who, onPerson }: { person: string; onPerson: (id: string) => void }) {
  const { db, kb, persons, counts } = useApp()
  const t = useT()
  const { lang } = useI18n()
  const [findingsBy, setFindingsBy] = useState<Record<string, Finding[]>>({})
  const [filter, setFilter] = useState<ViewerFilter>(NO_VIEWER_FILTER)
  const [question, setQuestion] = useState('')
  const [realNames, setRealNames] = useState(false)
  /** Ticked markers (rsids); when any of them is shown, only those go into the pack. */
  const [picked, setPicked] = useState<string[]>([])
  const send = useRef<HTMLDivElement>(null)

  const withDna = useMemo(() => persons.filter((p) => counts[p.id]), [persons, counts])
  const shown = useMemo(() => withDna.filter((p) => !who || p.id === who), [withDna, who])

  useEffect(() => {
    let live = true
    ;(async () => {
      const rsids = kb.entries.map((e) => e.rsid)
      const out: Record<string, Finding[]> = {}
      for (const p of withDna) out[p.id] = computeFindings(kb, await personCallsFor(db, p.id, rsids))
      if (live) setFindingsBy(out)
    })()
    return () => {
      live = false
    }
  }, [db, kb, withDna])

  const rows = useMemo(
    () =>
      viewerRows(
        kb,
        findingsBy,
        shown.map((p) => p.id),
        filter,
      ),
    [kb, findingsBy, shown, filter],
  )
  const toggleArea = (id: string) =>
    setFilter((f) => ({
      ...f,
      areas: f.areas.includes(id) ? f.areas.filter((a) => a !== id) : [...f.areas, id],
    }))
  const areaLabel = (id: string) => {
    const a = kb.areas.find((x) => x.id === id)
    return a ? areaName(a, lang) : id
  }

  const pickedRows = rows.filter((r) => picked.includes(r.entry.rsid))
  const togglePick = (rsid: string) =>
    setPicked((ps) => (ps.includes(rsid) ? ps.filter((x) => x !== rsid) : [...ps, rsid]))
  const packed = viewerPackPeople(pickedRows.length ? pickedRows : rows, shown)
  const asked = question.trim() || viewerQuestion(kb, filter.areas)
  const options = { question: asked, people: packed, realNames, template: EXPLAIN, compact: true }
  const pack = buildContextPack(options)
  const magClass = (m: number) => (m >= 3 ? 'mag hi' : m >= 2 ? 'mag mid' : 'mag')

  return (
    <div>
      <h1>{t('dnaPage.title')}</h1>
      <p className="muted">{t('dnaPage.intro')}</p>
      {withDna.length === 0 ? (
        <p className="notice info">{t('dnaPage.noDna')}</p>
      ) : (
        <div className="row tabs kinds">
          <button type="button" className={!who ? 'active' : ''} onClick={() => onPerson('')}>
            {t('dnaPage.everyone')}
          </button>
          {withDna.map((p) => (
            <button
              key={p.id}
              type="button"
              className={who === p.id ? 'active' : ''}
              onClick={() => onPerson(p.id)}
            >
              {p.displayName}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        <div>
          <button
            type="button"
            className={`tag${filter.areas.length ? '' : ' active'}`}
            aria-pressed={!filter.areas.length}
            onClick={() => setFilter((f) => ({ ...f, areas: [] }))}
          >
            {t('dnaPage.allAreas')}
          </button>
          {kb.areas.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`tag${filter.areas.includes(a.id) ? ' active' : ''}`}
              aria-pressed={filter.areas.includes(a.id)}
              onClick={() => toggleArea(a.id)}
            >
              {areaName(a, lang)}
            </button>
          ))}
        </div>
        <div className="row filters mt-3">
          <input
            type="search"
            value={filter.query}
            placeholder={t('dnaPage.search')}
            aria-label={t('dnaPage.search')}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
          />
          {shown.length > 0 && (
            <label className="check m-0">
              <input
                type="checkbox"
                checked={filter.notable}
                onChange={(e) => setFilter((f) => ({ ...f, notable: e.target.checked }))}
              />
              <span>{t('dnaPage.notable')}</span>
            </label>
          )}
          <span className="muted">{t('dnaPage.count', { n: rows.length })}</span>
        </div>
      </div>

      <div className="card">
        {pickedRows.length > 0 && (
          <div className="row mb-3">
            <span>{t('dnaPage.picked', { n: pickedRows.length })}</span>
            <button
              type="button"
              className="small primary"
              onClick={() => send.current?.scrollIntoView({ behavior: 'smooth' })}
            >
              {t('dnaPage.sendPicked')}
            </button>
            <button type="button" className="small" onClick={() => setPicked([])}>
              {t('dnaPage.clearPicked')}
            </button>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="muted">{t('dnaPage.noRows')}</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  {shown.length > 0 && <th aria-label={t('dnaPage.pick')} />}
                  <th>{t('dnaPage.colMarker')}</th>
                  {shown.map((p) => (
                    <th key={p.id}>{p.displayName}</th>
                  ))}
                  <th>{t('dnaPage.colEvidence')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ entry: e, findings }) => (
                  <tr key={e.rsid}>
                    {shown.length > 0 && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={t('dnaPage.pick')}
                          checked={picked.includes(e.rsid)}
                          onChange={() => togglePick(e.rsid)}
                        />
                      </td>
                    )}
                    <td>
                      <strong>{e.gene}</strong>{' '}
                      <a href={`https://www.ncbi.nlm.nih.gov/snp/${e.rsid}`} target="_blank" rel="noreferrer">
                        {e.rsid}
                      </a>
                      <br />
                      <span className="muted">{e.name}</span>
                      <br />
                      {e.areas.map((a) => (
                        <span key={a} className="badge">
                          {areaLabel(a)}
                        </span>
                      ))}
                      <br />
                      <span className="muted">{e.summary}</span>
                    </td>
                    {shown.map((p) => {
                      const f = findings[p.id]
                      return (
                        <td key={p.id}>
                          {f ? (
                            <>
                              <span className={magClass(f.match?.magnitude ?? 0)}>
                                {f.call.a1}/{f.call.a2}
                              </span>
                              <br />
                              {f.match?.label ?? <span className="muted">{t('dnaPage.undescribed')}</span>}
                            </>
                          ) : (
                            <span className="muted">{t('dnaPage.notGenotyped')}</span>
                          )}
                        </td>
                      )
                    })}
                    <td>
                      <span className={`badge ${e.evidence}`}>{e.evidence}</span>
                      {e.generated_by.startsWith('llm') && (
                        <>
                          <br />
                          <span className="muted">{t('dnaPage.draft')}</span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">{t('dnaPage.evidenceLegend')}</p>
      </div>

      {shown.length > 0 && (
        <>
          <div className="card" ref={send}>
            <h2>{t('dnaPage.sendHeading')}</h2>
            <p className="muted">{t('dnaPage.sendIntro')}</p>
            <label className="field">
              {t('dnaPage.question')}
              <textarea
                value={question}
                placeholder={viewerQuestion(kb, filter.areas)}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            <label className="check mt-3">
              <input type="checkbox" checked={realNames} onChange={(e) => setRealNames(e.target.checked)} />
              <span>{t('askPage.realNames')}</span>
            </label>
          </div>
          <PackPreview
            pack={pack}
            stats={packStats(options, pack)}
            people={packed.map((p) => p.person)}
            question={asked}
            realNames={realNames}
          />
        </>
      )}
    </div>
  )
}
