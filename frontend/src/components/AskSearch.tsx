import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { type AskData, keyOf } from '../ask/items'
import type { ItemKey } from '../ask/recommend'
import { personCallsFor } from '../db/repo'
import { describeEntry, filterHealthLog, NO_FILTER } from '../health/log'
import { useT } from '../i18n/context'
import { searchKb } from '../kb/kb'
import { type Call, HEALTH_KIND_LABELS, type HealthKind, type Person } from '../types'

const KINDS = Object.keys(HEALTH_KIND_LABELS) as HealthKind[]
const MAX_RESULTS = 60
type DnaScope = 'search' | 'drugs' | 'notable' | 'all'

/**
 * Find any record for the selected people and add it to the pack: the health log by text and kind,
 * DNA by gene, drug, condition or rsid. An rsid the knowledge base does not describe is looked up
 * in the stored genotypes directly, so any SNP from a raw file can be included.
 */
export function AskSearch({
  people,
  data,
  included,
  onToggle,
  onRaw,
}: {
  people: Person[]
  data: AskData
  included: Set<ItemKey>
  onToggle: (key: ItemKey) => void
  /** Genotypes looked up by rsid, handed to the page so an included one can be resolved later. */
  onRaw: (personId: string, calls: Call[]) => void
}) {
  const { db, kb } = useApp()
  const t = useT()
  const [tab, setTab] = useState<'health' | 'dna'>('health')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<HealthKind | ''>('')
  const [who, setWho] = useState('')
  const [dnaQuery, setDnaQuery] = useState('')
  const [scope, setScope] = useState<DnaScope>('search')
  const [lookedUp, setLookedUp] = useState<string[]>([])

  const scoped = people.filter((p) => !who || p.id === who)
  const name = (id: string) => people.find((p) => p.id === id)?.displayName ?? id

  const healthHits = useMemo(
    () =>
      scoped.flatMap((p) =>
        filterHealthLog(data.healthBy[p.id] ?? [], { ...NO_FILTER, kind, text }).map((h) => ({ p, h })),
      ),
    [scoped, data.healthBy, kind, text],
  )

  // rsids typed into the DNA search that the kb does not know: look them up in the genotype table.
  const kbRsids = useMemo(() => new Set(kb.entries.map((e) => e.rsid)), [kb])
  const rsids = useMemo(
    () => [...new Set(dnaQuery.toLowerCase().match(/rs\d+/g) ?? [])].filter((r) => !kbRsids.has(r)),
    [dnaQuery, kbRsids],
  )
  const rsidKey = rsids.join(',')
  const peopleKey = people.map((p) => p.id).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the joined rsids and people
  useEffect(() => {
    if (!rsids.length) return setLookedUp([])
    let live = true
    const timer = setTimeout(async () => {
      for (const p of people) onRaw(p.id, await personCallsFor(db, p.id, rsids))
      if (live) setLookedUp(rsids)
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [rsidKey, peopleKey, db])

  const entries = useMemo(() => {
    if (scope === 'search') {
      // Every word is its own search ("rs429358 warfarin"), results in kb order without repeats.
      const hits = new Set(dnaQuery.split(/[\s,;]+/).flatMap((w) => (w.length >= 2 ? searchKb(kb, w) : [])))
      return kb.entries.filter((e) => hits.has(e))
    }
    if (scope === 'drugs') return kb.entries.filter((e) => e.topic === 'pharmacogenomics')
    return kb.entries
  }, [scope, dnaQuery, kb])

  const Toggle = ({ k }: { k: ItemKey }) => (
    <button type="button" className={`small${included.has(k) ? ' active' : ''}`} onClick={() => onToggle(k)}>
      {included.has(k) ? t('askPage.included') : t('askPage.include')}
    </button>
  )

  return (
    <div className="card">
      <h2>{t('askPage.findHeading')}</h2>
      <div className="row tabs">
        <button type="button" className={tab === 'health' ? 'active' : ''} onClick={() => setTab('health')}>
          {t('askPage.tabHealth')}
        </button>
        <button type="button" className={tab === 'dna' ? 'active' : ''} onClick={() => setTab('dna')}>
          {t('askPage.tabDna')}
        </button>
      </div>
      {people.length > 1 && (
        <div className="row filters" style={{ marginTop: '0.6rem' }}>
          <select
            aria-label={t('healthPage.filterPerson')}
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">{t('askPage.allSelected')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
      )}
      {tab === 'health' ? (
        <>
          <div className="row filters" style={{ marginTop: '0.6rem' }}>
            <input
              type="search"
              placeholder={t('askPage.searchHealth')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <select
              aria-label={t('healthLog.kind')}
              value={kind}
              onChange={(e) => setKind(e.target.value as HealthKind | '')}
            >
              <option value="">{t('healthTable.allKinds')}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </select>
            {healthHits.length > 0 && (
              <button
                type="button"
                className="small"
                onClick={() =>
                  healthHits
                    .map(({ p, h }) => keyOf.health(p.id, h))
                    .filter((k) => !included.has(k))
                    .forEach(onToggle)
                }
              >
                {t('askPage.includeAll', { n: healthHits.length })}
              </button>
            )}
          </div>
          {healthHits.length === 0 ? (
            <p className="muted">{t('askPage.noHealthHits')}</p>
          ) : (
            <ul className="picklist">
              {healthHits.slice(0, MAX_RESULTS).map(({ p, h }) => (
                <li key={h.id}>
                  <Toggle k={keyOf.health(p.id, h)} />
                  <span>
                    {people.length > 1 && <strong>{p.displayName} · </strong>}
                    {describeEntry(h)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {healthHits.length > MAX_RESULTS && (
            <p className="muted">{t('askPage.moreResults', { n: healthHits.length - MAX_RESULTS })}</p>
          )}
        </>
      ) : (
        <>
          <div className="row filters" style={{ marginTop: '0.6rem' }}>
            <input
              type="search"
              placeholder={t('askPage.searchDna')}
              value={dnaQuery}
              onChange={(e) => {
                setDnaQuery(e.target.value)
                setScope('search')
              }}
            />
            {(['drugs', 'notable', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`small${scope === s ? ' active' : ''}`}
                onClick={() => setScope(scope === s ? 'search' : s)}
              >
                {t(`askPage.dnaScope.${s}`)}
              </button>
            ))}
          </div>
          {entries.length === 0 && rsids.length === 0 && (
            <p className="muted">{dnaQuery.trim() ? t('askPage.noDnaHits') : t('askPage.dnaHint')}</p>
          )}
          <ul className="picklist">
            {entries.flatMap((e) =>
              scoped.map((p) => {
                const f = data.findingsBy[p.id]?.find((x) => x.entry.rsid === e.rsid)
                if (scope === 'notable' && (f?.match?.magnitude ?? 0) < 2) return null
                return (
                  <li key={`${p.id}-${e.rsid}`}>
                    {f ? (
                      <Toggle k={keyOf.finding(p.id, f)} />
                    ) : (
                      <span className="muted small">{t('askPage.notGenotyped')}</span>
                    )}
                    <span>
                      {people.length > 1 && <strong>{p.displayName} · </strong>}
                      {e.gene} {e.rsid} {f ? `${f.call.a1}/${f.call.a2}` : ''} — {f?.match?.label ?? e.name}{' '}
                      <span className={`badge ${e.evidence}`}>{e.evidence}</span>
                    </span>
                  </li>
                )
              }),
            )}
            {lookedUp.flatMap((rsid) =>
              scoped.map((p) => {
                const c = data.rawBy[p.id]?.[rsid]
                return (
                  <li key={`${p.id}-${rsid}`}>
                    {c ? (
                      <Toggle k={keyOf.call(p.id, c)} />
                    ) : (
                      <span className="muted small">{t('askPage.notGenotyped')}</span>
                    )}
                    <span>
                      {people.length > 1 && <strong>{name(p.id)} · </strong>}
                      {c ? `${rsid} ${c.a1}/${c.a2} (chr${c.chromosome}:${c.position})` : rsid}{' '}
                      <span className="muted">{t('askPage.notInKb')}</span>
                    </span>
                  </li>
                )
              }),
            )}
          </ul>
        </>
      )}
    </div>
  )
}
