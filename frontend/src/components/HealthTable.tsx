import { Fragment, useMemo, useState } from 'react'
import {
  facets,
  filterHealthLog,
  formatValue,
  HEALTH_SORT_DEFAULT_DIR,
  type HealthFilter,
  type HealthSortKey,
  isFiltering,
  NO_FILTER,
  type SortDir,
  sortHealthLog,
} from '../health/log'
import { useT } from '../i18n/context'
import { HEALTH_KIND_LABELS, type HealthEntry, type HealthKind, type Person } from '../types'

const KINDS = Object.keys(HEALTH_KIND_LABELS) as HealthKind[]

/**
 * The health log as a table: kind chips with counts, filters for person, body part, tag, date
 * range, minimum severity and free text, and sortable columns. A row opens to show the full text.
 * The filter lives in the parent so other widgets (the measurement summary) can set it.
 */
export function HealthTable({
  entries,
  persons,
  showPerson,
  filter,
  onFilter,
  onDelete,
}: {
  entries: HealthEntry[]
  persons: Person[]
  showPerson: boolean
  filter: HealthFilter
  onFilter: (f: HealthFilter) => void
  onDelete?: (e: HealthEntry) => void
}) {
  const t = useT()
  const [sort, setSort] = useState<{ key: HealthSortKey; dir: SortDir }>({ key: 'date', dir: 'desc' })
  const [open, setOpen] = useState<string | null>(null)
  const name = (id: string) => persons.find((p) => p.id === id)?.displayName ?? id
  const { bodyParts, tags } = useMemo(() => facets(entries), [entries])
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

  const toggleSort = (key: HealthSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: HEALTH_SORT_DEFAULT_DIR[key] },
    )
  const SortTh = ({ k, label }: { k: HealthSortKey; label: string }) => (
    <th aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="sort" onClick={() => toggleSort(k)}>
        {label}
        <span className="muted"> {sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </button>
    </th>
  )

  if (entries.length === 0) return <p className="muted">{t('healthTable.empty')}</p>
  const columns = showPerson ? 8 : 7

  return (
    <div>
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
            className={filter.kind === k ? 'active' : ''}
            onClick={() => set({ kind: filter.kind === k ? '' : k })}
          >
            {t(`kind.${k}`)} <span className="muted">{counts.c[k]}</span>
          </button>
        ))}
      </div>
      <div className="row filters">
        {showPerson && (
          <select
            aria-label={t('healthPage.filterPerson')}
            value={filter.person}
            onChange={(e) => set({ person: e.target.value })}
          >
            <option value="">{t('healthPage.anyPerson')}</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label={t('healthLog.filterBodyPart')}
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
        <select
          aria-label={t('healthLog.filterTag')}
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
        <select
          aria-label={t('healthTable.minSeverity')}
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
        <label className="row inline">
          {t('healthTable.from')}
          <input
            type="date"
            value={filter.from}
            max={filter.to || undefined}
            onChange={(e) => set({ from: e.target.value })}
          />
        </label>
        <label className="row inline">
          {t('healthTable.to')}
          <input
            type="date"
            value={filter.to}
            min={filter.from || undefined}
            onChange={(e) => set({ to: e.target.value })}
          />
        </label>
        <input
          type="search"
          placeholder={t('healthLog.searchText')}
          value={filter.text}
          onChange={(e) => set({ text: e.target.value })}
        />
        {isFiltering(filter) && (
          <button type="button" className="small" onClick={() => onFilter(NO_FILTER)}>
            {t('common.clear')}
          </button>
        )}
        <span className="muted">{t('healthLog.shownOf', { n: shown.length, m: entries.length })}</span>
      </div>
      {shown.length === 0 ? (
        <p className="muted">{t('healthLog.nothingMatches')}</p>
      ) : (
        <div className="tablewrap">
          <table className="healthtable">
            <thead>
              <tr>
                <SortTh k="date" label={t('healthTable.colDate')} />
                {showPerson && <SortTh k="person" label={t('healthPage.colPerson')} />}
                <SortTh k="kind" label={t('healthLog.kind')} />
                <SortTh k="title" label={t('healthLog.titleField')} />
                <SortTh k="value" label={t('healthLog.value')} />
                <SortTh k="bodyPart" label={t('healthLog.bodyPart')} />
                <SortTh k="severity" label={t('healthLog.severity')} />
                <th>{t('healthTable.colTags')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <Fragment key={e.id}>
                  <tr
                    className={open === e.id ? 'open' : ''}
                    onClick={() => setOpen(open === e.id ? null : e.id)}
                  >
                    <td className="nowrap">{e.date}</td>
                    {showPerson && <td>{name(e.personId)}</td>}
                    <td>
                      <span className={`badge kind-${e.kind}`}>{t(`kind.${e.kind}`)}</span>
                    </td>
                    <td>
                      {e.title}
                      {e.body && <span className="muted"> ¶</span>}
                    </td>
                    <td className="nowrap">{formatValue(e)}</td>
                    <td>{e.bodyPart}</td>
                    <td>{e.severity === null ? '' : `${e.severity}/10`}</td>
                    <td>
                      {e.tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className="tag"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            set({ tag: filter.tag === tag ? '' : tag })
                          }}
                        >
                          {tag}
                        </button>
                      ))}
                    </td>
                  </tr>
                  {open === e.id && (
                    <tr className="detail">
                      <td colSpan={columns}>
                        {e.body ? (
                          <pre className="pack">{e.body}</pre>
                        ) : (
                          <p className="muted">{t('healthTable.noText')}</p>
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
                      </td>
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
