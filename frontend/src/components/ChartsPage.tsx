import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { availableMetrics, buildPanels, colourSlot, type Metric, type MetricSource } from '../charts/series'
import { listFamilyHealthLog } from '../db/repo'
import { findPreset } from '../health/presets'
import { type Translate, useI18n, useT } from '../i18n/context'
import type { Kb } from '../kb/kb'
import type { HealthEntry } from '../types'
import { TimeChart } from './TimeChart'

const DAY = 86_400_000
const RANGES = { '3m': 92 * DAY, '1y': 366 * DAY, '5y': 5 * 366 * DAY, all: null } as const
type Range = keyof typeof RANGES
const MAX_PEOPLE = 8
const STORE = 'hearth:charts'

interface Saved {
  people: string[]
  metrics: string[]
  range: Range
}

/** The last selection, a per-viewer convenience: ids only, never values. */
function loadSaved(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? 'null') as Saved | null
  } catch {
    return null
  }
}

export function metricLabel(kb: Kb, s: MetricSource, t: Translate, lang: string): string {
  if (s.kind === 'lab') {
    const a = kb.analytes.find((x) => x.id === s.analyte)
    return a ? (a.names[lang] ?? a.names.en) : s.analyte
  }
  if (s.kind === 'preset') {
    const pair = findPreset(s.preset)?.pair
    const name = t(`preset.${s.preset}`)
    return pair && s.part !== undefined ? `${name} (${t(`preset.pair.${pair[s.part]}`)})` : name
  }
  return s.title
}

/**
 * Charts: pick metrics and people, see each metric over time. One panel per metric (different
 * units never share an axis), one line per person in that person's fixed colour, all panels on
 * the same time range so they line up.
 */
export function ChartsPage() {
  const { db, kb, persons } = useApp()
  const t = useT()
  const { lang } = useI18n()
  const [entries, setEntries] = useState<HealthEntry[] | null>(null)
  const [saved] = useState(loadSaved)
  const [people, setPeople] = useState<string[] | null>(saved?.people ?? null)
  const [metrics, setMetrics] = useState<string[] | null>(saved?.metrics ?? null)
  const [range, setRange] = useState<Range>(saved?.range ?? 'all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    listFamilyHealthLog(db).then(setEntries)
  }, [db])

  const available = useMemo(() => (entries ? availableMetrics(kb, entries) : []), [kb, entries])
  const withReadings = persons.filter((p) => available.some((m) => m.personIds.includes(p.id)))
  // Defaults, and a saved selection pruned of what no longer exists.
  const chosenPeople = (people ?? withReadings.map((p) => p.id))
    .filter((id) => withReadings.some((p) => p.id === id))
    .slice(0, MAX_PEOPLE)
  const chosenMetrics = (metrics ?? available.slice(0, 3).map((m) => m.key)).filter((k) =>
    available.some((m) => m.key === k),
  )

  const span = RANGES[range]
  const now = Date.now()
  const panels = entries
    ? buildPanels(kb, entries, {
        metrics: chosenMetrics,
        people: chosenPeople,
        from: span === null ? null : now - span,
        to: null,
      })
    : []
  // One time axis for every panel: the range, or for "all" the extent of what is shown.
  const ts = panels.flatMap((p) => p.series.flatMap((s) => s.points.map((x) => x.t)))
  const domain: [number, number] =
    span === null ? [Math.min(...ts) - DAY, Math.max(...ts) + DAY] : [now - span, now]

  const label = (m: Pick<Metric, 'source'>) => metricLabel(kb, m.source, t, lang)
  const series = chosenPeople.map((id) => ({
    personId: id,
    name: persons.find((p) => p.id === id)?.displayName ?? id,
    colour: `var(--series-${colourSlot(persons, id)})`,
  }))
  const toggle = (list: string[], id: string, on: boolean) =>
    on ? [...list, id] : list.filter((x) => x !== id)
  const save = (next: Partial<Saved>) => {
    const all = { people: chosenPeople, metrics: chosenMetrics, range, ...next }
    setPeople(all.people)
    setMetrics(all.metrics)
    setRange(all.range)
    try {
      localStorage.setItem(STORE, JSON.stringify(all))
    } catch {}
  }
  const q = query.trim().toLowerCase()
  const groups = (['lab', 'measurement', 'other'] as const)
    .map((g) => ({
      g,
      ms: available.filter((m) => m.group === g && (!q || label(m).toLowerCase().includes(q))),
    }))
    .filter((x) => x.ms.length)

  if (entries === null) return null
  if (!available.length)
    return (
      <div>
        <h1>{t('charts.title')}</h1>
        <p className="muted">{t('charts.empty')}</p>
      </div>
    )

  return (
    <div>
      <h1>{t('charts.title')}</h1>
      <p className="muted">{t('charts.intro')}</p>
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start', gap: '1.5rem' }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="muted">{t('charts.people')}</legend>
            {withReadings.map((p) => (
              <label key={p.id} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={chosenPeople.includes(p.id)}
                  disabled={!chosenPeople.includes(p.id) && chosenPeople.length >= MAX_PEOPLE}
                  onChange={(e) => save({ people: toggle(chosenPeople, p.id, e.target.checked) })}
                />{' '}
                <span
                  className="swatch"
                  style={{ background: `var(--series-${colourSlot(persons, p.id)})` }}
                />
                {p.displayName}
              </label>
            ))}
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0, flex: 1, minWidth: '16rem' }}>
            <legend className="muted">{t('charts.metrics')}</legend>
            <input
              type="search"
              placeholder={t('charts.search')}
              aria-label={t('charts.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: '100%', marginBottom: '0.4rem' }}
            />
            <div className="metricpicker">
              {groups.map(({ g, ms }) => (
                <div key={g}>
                  <div className="muted">{t(`charts.group.${g}`)}</div>
                  {ms.map((m) => (
                    <label key={m.key}>
                      <input
                        type="checkbox"
                        checked={chosenMetrics.includes(m.key)}
                        onChange={(e) => save({ metrics: toggle(chosenMetrics, m.key, e.target.checked) })}
                      />{' '}
                      {label(m)} {m.unit && <span className="muted">({m.unit})</span>}{' '}
                      <span className="muted">· {t('charts.readings', { n: m.count })}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </fieldset>
          <label className="field">
            {t('charts.range')}
            <select value={range} onChange={(e) => save({ range: e.target.value as Range })}>
              {(Object.keys(RANGES) as Range[]).map((r) => (
                <option key={r} value={r}>
                  {t(`charts.range.${r}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {panels.length === 0 ? (
        <p className="muted">{t('charts.nothingSelected')}</p>
      ) : (
        panels.map((p) => (
          <TimeChart
            key={p.key}
            panel={p}
            title={label(p)}
            domain={domain}
            series={series.filter((s) => p.series.some((x) => x.personId === s.personId))}
          />
        ))
      )}
    </div>
  )
}
