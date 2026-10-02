import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { deleteHealthEntries, setHealthConditions } from '../db/repo'
import { exportHealthEntries } from '../export/openFormats'
import {
  daysBefore,
  facets,
  filterHealthLog,
  formatValue,
  groupByDate,
  HEALTH_SORT_DEFAULT_DIR,
  type HealthFilter,
  type HealthSortKey,
  isFiltering,
  NO_FILTER,
  panelFilterCount,
  type SortDir,
  sortHealthLog,
  when,
} from '../health/log'
import { today } from '../health/now'
import { measurementPreset, symptomPreset } from '../health/presets'
import { useI18n, useT } from '../i18n/context'
import { conditionById, conditionName, suggestConditions } from '../kb/conditions'
import { type Attachment, HEALTH_KIND_LABELS, type HealthEntry, type HealthKind, type Person } from '../types'
import { AttachmentList } from './AttachmentList'
import { ConditionPicker } from './ConditionPicker'
import { useDetailsText } from './DetailFields'

const KINDS = Object.keys(HEALTH_KIND_LABELS) as HealthKind[]

type View = 'cards' | 'table'
const VIEWS: View[] = ['cards', 'table']
const VIEW_KEY = 'hearth.healthView'

/** The stored choice, else cards on a phone and the table on anything wider. */
const loadView = (): View => {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    if (VIEWS.includes(v as View)) return v as View
  } catch {
    // blocked storage: fall through to the width default
  }
  return typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px)').matches ? 'cards' : 'table'
}

const icon = (d: string) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="hl-icon">
    <path d={d} />
  </svg>
)
/** Stacked cards and a ruled table for the view switch (whose labels hide on phones), a lens, a funnel. */
const ICONS = {
  cards: icon('M2.5 2.5h11v4.5h-11zM2.5 9h11v4.5h-11z'),
  table: icon('M2 3h12M2 6.5h12M2 10h12M2 13.5h12M6 3v10.5'),
  search: icon('M7 2.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9zM10.3 10.3L14 14'),
  filters: icon('M2 3.5h12M4.5 8h7M7 12.5h2'),
}

/** Quick date ranges, in days back from today (today included). */
const PERIODS = [7, 30, 90, 365]

const severityClass = (n: number) => (n >= 7 ? 'mag hi' : n >= 4 ? 'mag mid' : 'mag')

/**
 * The health log as cards or a table: kind chips with counts, a search box, a Filters panel
 * (person, body part, tag, condition, minimum severity, date range with quick periods) whose active
 * filters show as removable chips, and a sort control. Cards are grouped under day headings when
 * sorted by date; table columns sort on click. An entry opens to show its full text, attachments
 * and the conditions it is linked to, which can be changed there (`onChange` then reloads the log).
 * The filter lives in the parent so other widgets (the measurement summary) can set it.
 */
export function HealthTable({
  entries,
  persons,
  attachments,
  showPerson,
  filter,
  onFilter,
  onDelete,
  onChange,
  onDeleteAttachment,
}: {
  entries: HealthEntry[]
  persons: Person[]
  /** Each entry's attached documents, keyed by entry id; loaded once by the parent. */
  attachments?: Record<string, Attachment[]>
  showPerson: boolean
  filter: HealthFilter
  onFilter: (f: HealthFilter) => void
  onDelete?: (e: HealthEntry) => void
  onChange?: () => void
  onDeleteAttachment?: (a: Attachment) => void
}) {
  const { db, kb } = useApp()
  const { lang } = useI18n()
  const t = useT()
  const detailsText = useDetailsText()
  const [sort, setSort] = useState<{ key: HealthSortKey; dir: SortDir }>({ key: 'date', dir: 'desc' })
  const [open, setOpen] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>(loadView)
  const [panel, setPanel] = useState(false)
  const name = (id: string) => persons.find((p) => p.id === id)?.displayName ?? id
  const { bodyParts, tags, conditions } = useMemo(() => facets(entries), [entries])
  const conditionLabel = (id: string) => {
    const c = conditionById(kb, id)
    return c ? conditionName(c, lang) : id
  }
  const link = async (e: HealthEntry, ids: string[]) => {
    await setHealthConditions(db, e.id, ids)
    onChange?.()
  }
  const counts = useMemo(() => {
    const byPerson = filterHealthLog(entries, { ...NO_FILTER, person: filter.person })
    const c = {} as Record<HealthKind, number>
    for (const e of byPerson) c[e.kind] = (c[e.kind] ?? 0) + 1
    return { all: byPerson.length, c }
  }, [entries, filter.person])
  // biome-ignore lint/correctness/useExhaustiveDependencies: name derives from persons
  const shown = useMemo(
    () => sortHealthLog(filterHealthLog(entries, filter), sort.key, sort.dir, name),
    [entries, filter, sort, persons],
  )
  const set = (patch: Partial<HealthFilter>) => onFilter({ ...filter, ...patch })
  // A deleted or reloaded entry leaves the selection.
  useEffect(() => {
    setPicked((p) => {
      const ids = new Set(entries.map((e) => e.id))
      const kept = [...p].filter((id) => ids.has(id))
      return kept.length === p.size ? p : new Set(kept)
    })
  }, [entries])
  const pick = (id: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allShown = shown.length > 0 && shown.every((e) => picked.has(e.id))
  const someShown = shown.some((e) => picked.has(e.id))
  const pickShown = () =>
    setPicked((p) => {
      const n = new Set(p)
      for (const e of shown) {
        if (allShown) n.delete(e.id)
        else n.add(e.id)
      }
      return n
    })
  const selection = () => entries.filter((e) => picked.has(e.id))
  const downloadPicked = async () => {
    setBusy(true)
    try {
      await exportHealthEntries(db, persons, selection(), 'csv')
    } finally {
      setBusy(false)
    }
  }
  const deletePicked = async () => {
    if (!confirm(t('healthTable.confirmDeleteMany', { n: picked.size }))) return
    setBusy(true)
    try {
      await deleteHealthEntries(db, [...picked])
      setPicked(new Set())
      onChange?.()
    } finally {
      setBusy(false)
    }
  }
  const checkbox = (e: HealthEntry, className?: string) => (
    <input
      type="checkbox"
      className={className}
      checked={picked.has(e.id)}
      aria-label={t('healthTable.selectRow', { title: e.title, date: e.date })}
      onClick={(ev) => ev.stopPropagation()}
      onChange={() => pick(e.id)}
    />
  )
  const toggle = (id: string) => setOpen(open === id ? null : id)
  const pickView = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // private mode or blocked storage: the choice just does not survive a reload
    }
  }

  const now = today()
  const periodFrom = (days: number) => daysBefore(now, days - 1)
  const dayHeading = (date: string) => {
    if (date === now) return t('healthTable.today')
    if (date === daysBefore(now, 1)) return t('healthTable.yesterday')
    const [y, m, d] = date.split('-').map(Number)
    return new Intl.DateTimeFormat(lang, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: date.slice(0, 4) === now.slice(0, 4) ? undefined : 'numeric',
    }).format(new Date(y, m - 1, d))
  }

  const sortLabels: Record<HealthSortKey, string> = {
    date: t('healthTable.colDate'),
    person: t('healthPage.colPerson'),
    kind: t('healthLog.kind'),
    title: t('healthLog.titleField'),
    value: t('healthLog.value'),
    bodyPart: t('healthLog.bodyPart'),
    severity: t('healthLog.severity'),
  }
  const sortKeys = (Object.keys(sortLabels) as HealthSortKey[]).filter((k) => showPerson || k !== 'person')
  const toggleSort = (key: HealthSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: HEALTH_SORT_DEFAULT_DIR[key] },
    )
  const SortTh = ({ k }: { k: HealthSortKey }) => (
    <th aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="sort" onClick={() => toggleSort(k)}>
        {sortLabels[k]}
        <span className="muted"> {sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </button>
    </th>
  )

  // The active panel filters as removable chips, so a closed panel still says what is hidden.
  const chips: { key: string; label: string; clear: Partial<HealthFilter> }[] = []
  if (filter.person) chips.push({ key: 'person', label: name(filter.person), clear: { person: '' } })
  if (filter.bodyPart) chips.push({ key: 'bodyPart', label: filter.bodyPart, clear: { bodyPart: '' } })
  if (filter.tag) chips.push({ key: 'tag', label: `#${filter.tag}`, clear: { tag: '' } })
  if (filter.condition)
    chips.push({ key: 'condition', label: conditionLabel(filter.condition), clear: { condition: '' } })
  if (filter.minSeverity !== null)
    chips.push({
      key: 'severity',
      label: t('healthTable.severityAtLeast', { n: filter.minSeverity }),
      clear: { minSeverity: null },
    })
  if (filter.from || filter.to)
    chips.push({
      key: 'period',
      label: `${filter.from || '…'} – ${filter.to || '…'}`,
      clear: { from: '', to: '' },
    })
  const panelCount = panelFilterCount(filter)

  const tagButtons = (e: HealthEntry) =>
    e.tags.map((tag) => (
      <button
        key={tag}
        type="button"
        className={`tag${filter.tag === tag ? ' active' : ''}`}
        onClick={(ev) => {
          ev.stopPropagation()
          set({ tag: filter.tag === tag ? '' : tag })
        }}
      >
        {tag}
      </button>
    ))
  const conditionButtons = (e: HealthEntry) =>
    e.conditions.map((id) => (
      <button
        key={id}
        type="button"
        className={`tag condition${filter.condition === id ? ' active' : ''}`}
        onClick={(ev) => {
          ev.stopPropagation()
          set({ condition: filter.condition === id ? '' : id })
        }}
      >
        {conditionLabel(id)}
      </button>
    ))
  const flag = (e: HealthEntry) =>
    e.flag ? <span className="danger"> {e.flag === 'H' ? '↑' : '↓'}</span> : null
  const clip = (e: HealthEntry): ReactNode =>
    attachments?.[e.id]?.length ? (
      <span className="muted" title={t('healthTable.hasAttachments', { n: attachments[e.id].length })}>
        📎{attachments[e.id].length}
      </span>
    ) : null
  const detail = (e: HealthEntry) => (
    <div className="hl-detail">
      {e.body ? <pre className="pack">{e.body}</pre> : <p className="muted">{t('healthTable.noText')}</p>}
      {onDeleteAttachment && (
        <AttachmentList items={attachments?.[e.id] ?? []} onDelete={onDeleteAttachment} />
      )}
      {onChange && (
        <ConditionPicker
          value={e.conditions}
          suggestions={suggestConditions(kb, {
            ...e,
            preset: e.kind === 'measurement' ? measurementPreset(e.title)?.id : undefined,
          })}
          onChange={(ids) => link(e, ids)}
        />
      )}
      <div className="row">
        {e.source && (
          <span className="badge" title={e.source}>
            {t('healthLog.transcribedBy', { model: e.source.split(':')[0] })}
          </span>
        )}
        {onDelete && (
          <button type="button" className="small danger" onClick={() => onDelete(e)}>
            {t('common.delete')}
          </button>
        )}
      </div>
    </div>
  )

  if (entries.length === 0) return <p className="muted">{t('healthTable.empty')}</p>

  const card = (e: HealthEntry, grouped: boolean) => (
    <li key={e.id} className={`hl-card kind-${e.kind}${open === e.id ? ' open' : ''}`}>
      {checkbox(e, 'hl-pick')}
      <button
        type="button"
        className="hl-card-main"
        aria-expanded={open === e.id}
        onClick={() => toggle(e.id)}
      >
        <span className="hl-card-top">
          <span className={`badge kind-${e.kind}`}>{t(`kind.${e.kind}`)}</span>
          {showPerson && <span className="hl-person">{name(e.personId)}</span>}
          <span className="hl-when muted">{grouped ? e.time : when(e)}</span>
        </span>
        <span className="hl-title">{e.title}</span>
        {e.value !== null && (
          <span className="hl-value">
            {formatValue(e)}
            {flag(e)}
          </span>
        )}
        {(e.bodyPart ||
          e.severity !== null ||
          e.body ||
          Object.keys(e.details).length > 0 ||
          !!attachments?.[e.id]?.length) && (
          <span className="hl-meta muted">
            {e.bodyPart && (
              <span>
                {e.bodyPart}
                {e.side && ` · ${t(`side.${e.side}`)}`}
              </span>
            )}
            {Object.keys(e.details).length > 0 && (
              <span>{detailsText(symptomPreset(e.title)?.details, e.details)}</span>
            )}
            {e.severity !== null && (
              <span>
                {t('healthLog.severity')} <span className={severityClass(e.severity)}>{e.severity}/10</span>
              </span>
            )}
            {e.body && <span>¶</span>}
            {clip(e)}
          </span>
        )}
      </button>
      {(e.conditions.length > 0 || e.tags.length > 0) && (
        <div className="hl-tags">
          {conditionButtons(e)}
          {tagButtons(e)}
        </div>
      )}
      {open === e.id && detail(e)}
    </li>
  )

  return (
    <div className="healthlog">
      <div className="row tabs kinds">
        <button
          type="button"
          className={filter.kind === '' ? 'active' : ''}
          onClick={() => set({ kind: '' })}
        >
          {t('healthTable.allKinds')} <span className="muted">{counts.all}</span>
        </button>
        {KINDS.filter((k) => counts.c[k]).map((k) => (
          <button
            key={k}
            type="button"
            className={`kind-${k}${filter.kind === k ? ' active' : ''}`}
            onClick={() => set({ kind: filter.kind === k ? '' : k })}
          >
            {t(`kind.${k}`)} <span className="muted">{counts.c[k]}</span>
          </button>
        ))}
      </div>

      <div className="hl-toolbar">
        <label className="hl-search">
          {ICONS.search}
          <input
            type="search"
            placeholder={t('healthLog.searchText')}
            aria-label={t('healthLog.searchText')}
            value={filter.text}
            onChange={(e) => set({ text: e.target.value })}
          />
        </label>
        <button
          type="button"
          className={`hl-filterbtn${panelCount ? ' active' : ''}`}
          aria-expanded={panel}
          onClick={() => setPanel(!panel)}
        >
          {ICONS.filters}
          {t('healthTable.filters')}
          {panelCount > 0 && <span className="hl-count">{panelCount}</span>}
        </button>
        <div className="hl-sort">
          <select
            aria-label={t('healthTable.sortBy')}
            value={sort.key}
            onChange={(e) => {
              const key = e.target.value as HealthSortKey
              setSort({ key, dir: HEALTH_SORT_DEFAULT_DIR[key] })
            }}
          >
            {sortKeys.map((k) => (
              <option key={k} value={k}>
                {sortLabels[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="hl-dir"
            aria-label={t(sort.dir === 'asc' ? 'healthTable.sortAsc' : 'healthTable.sortDesc')}
            title={t(sort.dir === 'asc' ? 'healthTable.sortAsc' : 'healthTable.sortDesc')}
            onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          >
            {sort.dir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
        <div className="segmented">
          {VIEWS.map((v) => (
            <button
              type="button"
              key={v}
              className={view === v ? 'active' : ''}
              aria-pressed={view === v}
              aria-label={t(v === 'cards' ? 'healthTable.viewCards' : 'healthTable.viewTable')}
              onClick={() => pickView(v)}
            >
              {ICONS[v]}
              <span className="hl-viewlabel">
                {t(v === 'cards' ? 'healthTable.viewCards' : 'healthTable.viewTable')}
              </span>
            </button>
          ))}
        </div>
      </div>

      {panel && (
        <div className="hl-panel">
          <div className="hl-fields">
            {showPerson && (
              <label className="field">
                {t('healthPage.filterPerson')}
                <select value={filter.person} onChange={(e) => set({ person: e.target.value })}>
                  <option value="">{t('healthPage.anyPerson')}</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              {t('healthLog.filterBodyPart')}
              <select
                value={filter.bodyPart}
                disabled={bodyParts.length === 0}
                onChange={(e) => set({ bodyPart: e.target.value })}
              >
                <option value="">{t('healthLog.anyBodyPart')}</option>
                {bodyParts.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('healthLog.filterTag')}
              <select
                value={filter.tag}
                disabled={tags.length === 0}
                onChange={(e) => set({ tag: e.target.value })}
              >
                <option value="">{t('healthLog.anyTag')}</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('healthLog.filterCondition')}
              <select
                value={filter.condition}
                disabled={conditions.length === 0}
                onChange={(e) => set({ condition: e.target.value })}
              >
                <option value="">{t('healthLog.allConditions')}</option>
                {conditions.map((id) => (
                  <option key={id} value={id}>
                    {conditionLabel(id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('healthTable.minSeverity')}
              <select
                value={filter.minSeverity ?? ''}
                onChange={(e) => set({ minSeverity: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">{t('healthTable.anySeverity')}</option>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {t('healthTable.severityAtLeast', { n })}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('healthTable.from')}
              <input
                type="date"
                value={filter.from}
                max={filter.to || undefined}
                onChange={(e) => set({ from: e.target.value })}
              />
            </label>
            <label className="field">
              {t('healthTable.to')}
              <input
                type="date"
                value={filter.to}
                min={filter.from || undefined}
                onChange={(e) => set({ to: e.target.value })}
              />
            </label>
          </div>
          <div className="row hl-periods">
            <span className="muted">{t('healthTable.period')}</span>
            {PERIODS.map((days) => {
              const active = filter.from === periodFrom(days) && !filter.to
              return (
                <button
                  key={days}
                  type="button"
                  className={`tag${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onClick={() => set(active ? { from: '', to: '' } : { from: periodFrom(days), to: '' })}
                >
                  {days === 365 ? t('healthTable.periodYear') : t('healthTable.periodDays', { n: days })}
                </button>
              )
            })}
          </div>
          <div className="row hl-panel-actions">
            <button
              type="button"
              disabled={panelCount === 0}
              onClick={() =>
                set({ person: '', bodyPart: '', tag: '', condition: '', minSeverity: null, from: '', to: '' })
              }
            >
              {t('common.clear')}
            </button>
            <button type="button" className="primary" onClick={() => setPanel(false)}>
              {t('healthTable.showResults', { n: shown.length })}
            </button>
          </div>
        </div>
      )}

      {picked.size > 0 && (
        <div className="notice row hl-selection" role="status">
          <span>{t('healthTable.selected', { n: picked.size })}</span>
          <button type="button" className="small" disabled={busy} onClick={downloadPicked}>
            {t('healthTable.downloadSelected')}
          </button>
          {onDelete && (
            <button type="button" className="small danger" disabled={busy} onClick={deletePicked}>
              {t('healthTable.deleteSelected')}
            </button>
          )}
          <button type="button" className="link" onClick={() => setPicked(new Set())}>
            {t('healthTable.clearSelection')}
          </button>
        </div>
      )}

      <div className="row hl-status">
        {shown.length > 0 && (
          <label className="check">
            <input
              type="checkbox"
              checked={allShown}
              ref={(el) => {
                if (el) el.indeterminate = someShown && !allShown
              }}
              onChange={pickShown}
            />
            <span>{t('healthTable.selectAll')}</span>
          </label>
        )}
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className="tag active hl-chip"
            aria-label={t('healthTable.removeFilter', { label: c.label })}
            onClick={() => set(c.clear)}
          >
            {c.label} ✕
          </button>
        ))}
        <span className="muted">{t('healthLog.shownOf', { n: shown.length, m: entries.length })}</span>
        {isFiltering(filter) && (
          <button type="button" className="link" onClick={() => onFilter(NO_FILTER)}>
            {t('common.clear')}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="muted">{t('healthLog.nothingMatches')}</p>
      ) : view === 'cards' ? (
        sort.key === 'date' ? (
          groupByDate(shown).map((g) => (
            <section key={g.date} className="hl-day">
              <h3 className="hl-dayhead">
                {dayHeading(g.date)}
                <span className="muted"> · {g.entries.length}</span>
              </h3>
              <ul className="hl-cards">{g.entries.map((e) => card(e, true))}</ul>
            </section>
          ))
        ) : (
          <ul className="hl-cards">{shown.map((e) => card(e, false))}</ul>
        )
      ) : (
        <div className="tablewrap">
          <table className="healthtable">
            <thead>
              <tr>
                <th className="pick" aria-label={t('healthTable.selectAll')} />
                <SortTh k="date" />
                {showPerson && <SortTh k="person" />}
                <SortTh k="kind" />
                <SortTh k="title" />
                <SortTh k="value" />
                <SortTh k="bodyPart" />
                <SortTh k="severity" />
                <th>{t('healthTable.colTags')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <Fragment key={e.id}>
                  <tr className={open === e.id ? 'open' : ''} onClick={() => toggle(e.id)}>
                    <td className="pick">{checkbox(e)}</td>
                    <td className="nowrap">
                      {e.date}
                      {e.time && <span className="muted"> {e.time}</span>}
                    </td>
                    {showPerson && <td>{name(e.personId)}</td>}
                    <td>
                      <span className={`badge kind-${e.kind}`}>{t(`kind.${e.kind}`)}</span>
                    </td>
                    <td>
                      {e.title}
                      {e.body && <span className="muted"> ¶</span>} {clip(e)}
                    </td>
                    <td className="nowrap">
                      {formatValue(e)}
                      {Object.keys(e.details).length > 0 && (
                        <span className="muted">
                          {detailsText(symptomPreset(e.title)?.details, e.details)}
                        </span>
                      )}
                      {flag(e)}
                    </td>
                    <td>
                      {e.bodyPart}
                      {e.bodyPart && e.side && <span className="muted"> · {t(`side.${e.side}`)}</span>}
                    </td>
                    <td>
                      {e.severity === null ? (
                        ''
                      ) : (
                        <span className={severityClass(e.severity)}>{e.severity}/10</span>
                      )}
                    </td>
                    <td>
                      {conditionButtons(e)}
                      {tagButtons(e)}
                    </td>
                  </tr>
                  {open === e.id && (
                    <tr className="detail">
                      <td colSpan={showPerson ? 9 : 8}>{detail(e)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
