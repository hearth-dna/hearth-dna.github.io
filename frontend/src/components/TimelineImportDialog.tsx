import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { addHealthEntries, listHealthLog } from '../db/repo'
import { MEASUREMENT_PRESETS } from '../health/presets'
import { useI18n, useT } from '../i18n/context'
import { sha256Hex } from '../import/unpack'
import { parseTable } from '../text/table'
import type { DateFormat } from '../timeline/dates'
import {
  buildEntries,
  type Mapping,
  type MetricMap,
  type Role,
  suggestMapping,
  suggestNames,
  type Target,
} from '../timeline/import'
import type { HealthEntry, Person } from '../types'
import { ConsentForm } from './ConsentForm'

const FORMATS: DateFormat[] = ['ymd', 'dmy', 'mdy', 'serial', 'unix']
const WIDE_ROLES = ['ignore', 'date', 'time', 'note', 'metric'] as const
const LONG_ROLES = ['ignore', 'date', 'time', 'note', 'name', 'value', 'unit'] as const

/** A target as one select value: `preset:weight`, `preset:blood-pressure:1`, `lab:glucose`, `custom`. */
const targetValue = (t: Target) =>
  t.kind === 'preset'
    ? `preset:${t.preset}${t.part === undefined ? '' : `:${t.part}`}`
    : t.kind === 'lab'
      ? `lab:${t.analyte}`
      : 'custom'

function parseTarget(v: string, title: string): Target {
  const [kind, id, part] = v.split(':')
  if (kind === 'preset')
    return part === undefined ? { kind, preset: id } : { kind, preset: id, part: Number(part) as 0 | 1 }
  if (kind === 'lab') return { kind, analyte: id }
  return { kind: 'custom', title }
}

/**
 * Import a CSV timeline for one person: weight, height, blood pressure, a lab value over time,
 * from a spreadsheet or a phone or device export. The user says what each column is (and, for a
 * one-reading-per-row export, what each metric name is); the preview shows exactly what will be
 * added, in the app's units, and what is left out and why. Local only: nothing leaves the device.
 */
export function TimelineImportDialog({
  person,
  onClose,
  onImported,
}: {
  person: Person
  onClose: () => void
  onImported: (n: number) => void
}) {
  const { db, kb } = useApp()
  const t = useT()
  const { lang } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [mapping, setMapping] = useState<Mapping | null>(null)
  const [existing, setExisting] = useState<HealthEntry[]>([])
  const [consented, setConsented] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ref.current?.showModal()
    hasConsent(db, 'import_document', person.id).then(setConsented)
    listHealthLog(db, person.id).then(setExisting)
  }, [db, person.id])

  const presetNames = (id: string) => [t(`preset.${id}`)]
  const labTitle = (id: string) => {
    const a = kb.analytes.find((x) => x.id === id)
    return a ? (a.names[lang] ?? a.names.en) : id
  }
  const table = useMemo(() => parseTable(text), [text])
  // Rebuilt on every edit of the mapping: a few thousand rows take milliseconds.
  const result = mapping
    ? buildEntries(kb, table, mapping, { personId: person.id, source, existing, labTitle })
    : null

  const read = async () => {
    if (table.header.length < 2 || !table.rows.length) return setError(t('timelineImport.notATable'))
    setError('')
    setSource(`csv:${await sha256Hex(new TextEncoder().encode(text))}`)
    setMapping(suggestMapping(kb, table, presetNames))
  }

  const setColumn = (i: number, role: Role) => {
    if (!mapping) return
    const columns = mapping.columns.map((c, j) => (j === i ? role : c))
    const names = mapping.shape === 'long' ? suggestNames(kb, table, { columns }, presetNames) : {}
    setMapping({ ...mapping, columns, names: mapping.shape === 'long' ? { ...names, ...mapping.names } : {} })
  }

  const roleFor = (role: string, i: number): Role => {
    if (role === 'date') return { role, format: 'ymd' }
    if (role === 'metric') {
      const header = table.header[i]
      return { role, metric: { target: { kind: 'custom', title: header }, unit: '' } }
    }
    return { role } as Role
  }

  const save = async () => {
    if (!result) return
    setSaving(true)
    try {
      const n = await addHealthEntries(db, result.entries)
      onImported(n)
      ref.current?.close()
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  const targetSelect = (m: MetricMap, onChange: (m: MetricMap | null) => void, allowNone = false) => (
    <>
      <select
        aria-label={t('timelineImport.metric')}
        value={m ? targetValue(m.target) : ''}
        onChange={(e) =>
          onChange(
            e.target.value === ''
              ? null
              : {
                  ...m,
                  target: parseTarget(e.target.value, m.target.kind === 'custom' ? m.target.title : ''),
                },
          )
        }
      >
        {allowNone && <option value="">{t('timelineImport.leaveOut')}</option>}
        <optgroup label={t('charts.group.measurement')}>
          {MEASUREMENT_PRESETS.flatMap((p) =>
            p.pair
              ? p.pair.map((half, part) => (
                  <option key={`${p.id}:${half}`} value={`preset:${p.id}:${part}`}>
                    {t(`preset.${p.id}`)} ({t(`preset.pair.${half}`)})
                  </option>
                ))
              : [
                  <option key={p.id} value={`preset:${p.id}`}>
                    {t(`preset.${p.id}`)} ({p.unit})
                  </option>,
                ],
          )}
        </optgroup>
        <optgroup label={t('charts.group.lab')}>
          {kb.analytes.map((a) => (
            <option key={a.id} value={`lab:${a.id}`}>
              {a.names[lang] ?? a.names.en} ({a.unit})
            </option>
          ))}
        </optgroup>
        <option value="custom">{t('timelineImport.custom')}</option>
      </select>
      {m.target.kind === 'custom' && (
        <input
          aria-label={t('timelineImport.customName')}
          placeholder={t('timelineImport.customName')}
          value={m.target.title}
          onChange={(e) => onChange({ ...m, target: { kind: 'custom', title: e.target.value } })}
        />
      )}
      <input
        aria-label={t('healthLog.unit')}
        placeholder={t('timelineImport.unitInFile')}
        size={8}
        value={m.unit}
        onChange={(e) => onChange({ ...m, unit: e.target.value })}
      />
    </>
  )

  const reasons = new Map<string, number>()
  for (const x of result?.skipped ?? []) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1)
  const hasDate = mapping?.columns.some((c) => c.role === 'date')

  return (
    <dialog ref={ref} onClose={onClose} className="wide">
      <h2 style={{ marginTop: 0 }}>{t('timelineImport.title', { name: person.displayName })}</h2>
      {consented === false ? (
        <ConsentForm
          kind="import_document"
          onCancel={() => ref.current?.close()}
          onConfirm={async () => {
            await grantConsent(db, 'import_document', person.id)
            setConsented(true)
          }}
        />
      ) : !mapping ? (
        <div>
          <p className="muted">{t('timelineImport.intro')}</p>
          <label className="field">
            {t('timelineImport.file')}
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) setText(await f.text())
              }}
            />
          </label>
          <label className="field" style={{ marginTop: '0.6rem' }}>
            {t('timelineImport.paste')}
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {error && <p className="danger">{error}</p>}
          <div className="row" style={{ marginTop: '0.8rem' }}>
            <button type="button" className="primary" disabled={!text.trim()} onClick={read}>
              {t('readDocumentDialog.continue')}
            </button>
            <button type="button" onClick={() => ref.current?.close()}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <label className="field">
            {t('timelineImport.shape')}
            <select
              value={mapping.shape}
              onChange={(e) => {
                const shape = e.target.value as Mapping['shape']
                const columns = mapping.columns.map((c) =>
                  (shape === 'wide' ? LONG_ROLES : WIDE_ROLES).includes(c.role as never) &&
                  !(shape === 'wide' ? WIDE_ROLES : LONG_ROLES).includes(c.role as never)
                    ? ({ role: 'ignore' } as Role)
                    : c,
                )
                setMapping({
                  ...mapping,
                  shape,
                  columns,
                  names: shape === 'long' ? suggestNames(kb, table, { columns }, presetNames) : {},
                })
              }}
            >
              <option value="wide">{t('timelineImport.shape.wide')}</option>
              <option value="long">{t('timelineImport.shape.long')}</option>
            </select>
          </label>
          <div className="tablewrap" style={{ marginTop: '0.6rem' }}>
            <table className="healthtable labreview">
              <thead>
                <tr>
                  <th>{t('timelineImport.column')}</th>
                  <th>{t('timelineImport.sample')}</th>
                  <th>{t('timelineImport.isWhat')}</th>
                </tr>
              </thead>
              <tbody>
                {table.header.map((h, i) => {
                  const c = mapping.columns[i]
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional and headers may repeat
                    <tr key={i}>
                      <td>{h}</td>
                      <td className="muted">
                        {table.rows
                          .slice(0, 3)
                          .map((r) => r[i])
                          .filter(Boolean)
                          .join(' · ')}
                      </td>
                      <td>
                        <div className="row" style={{ gap: '0.4rem' }}>
                          <select
                            aria-label={t('timelineImport.isWhat')}
                            value={c.role}
                            onChange={(e) => setColumn(i, roleFor(e.target.value, i))}
                          >
                            {(mapping.shape === 'wide' ? WIDE_ROLES : LONG_ROLES).map((r) => (
                              <option key={r} value={r}>
                                {t(`timelineImport.role.${r}`)}
                              </option>
                            ))}
                          </select>
                          {c.role === 'date' && (
                            <select
                              aria-label={t('timelineImport.dateFormat')}
                              value={c.format}
                              onChange={(e) =>
                                setMapping({
                                  ...mapping,
                                  ambiguousDate: false,
                                  columns: mapping.columns.map((x, j) =>
                                    j === i ? { role: 'date', format: e.target.value as DateFormat } : x,
                                  ),
                                })
                              }
                            >
                              {FORMATS.map((f) => (
                                <option key={f} value={f}>
                                  {t(`timelineImport.format.${f}`)}
                                </option>
                              ))}
                            </select>
                          )}
                          {c.role === 'metric' &&
                            targetSelect(c.metric, (m) => m && setColumn(i, { role: 'metric', metric: m }))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {mapping.ambiguousDate && <p className="notice">{t('timelineImport.ambiguousDate')}</p>}
          {mapping.shape === 'long' && Object.keys(mapping.names).length > 0 && (
            <>
              <h3>{t('timelineImport.names')}</h3>
              {Object.entries(mapping.names).map(([name, m]) => (
                <div key={name} className="row" style={{ gap: '0.4rem', marginBottom: '0.3rem' }}>
                  <span style={{ minWidth: '14rem' }}>{name}</span>
                  {targetSelect(
                    m ?? { target: { kind: 'custom', title: name }, unit: '' },
                    (next) => setMapping({ ...mapping, names: { ...mapping.names, [name]: next } }),
                    true,
                  )}
                </div>
              ))}
            </>
          )}
          {result && (
            <div className="notice" style={{ marginTop: '0.8rem' }}>
              <p style={{ margin: 0 }}>
                {hasDate
                  ? t('timelineImport.willAdd', { n: result.entries.length })
                  : t('timelineImport.needDate')}
              </p>
              {[...reasons].map(([reason, n]) => (
                <div key={reason} className="muted">
                  {t(`timelineImport.skip.${reason}`, { n })}
                </div>
              ))}
              {result.blocked.map((b) => (
                <div key={`${b.label}|${b.unit}`} className="danger">
                  {t('timelineImport.blocked', { metric: b.label, unit: b.unit })}
                </div>
              ))}
            </div>
          )}
          {result && result.entries.length > 0 && (
            <ul className="muted">
              {result.entries.slice(0, 5).map((e, n) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed preview of the first rows
                <li key={n}>
                  {e.date}
                  {e.time ? ` ${e.time}` : ''} · {e.title}: {e.value}
                  {e.value2 != null ? `/${e.value2}` : ''} {e.unit}
                </li>
              ))}
            </ul>
          )}
          {error && <p className="danger">{error}</p>}
          <div className="row" style={{ marginTop: '0.8rem' }}>
            <button
              type="button"
              className="primary"
              disabled={!result?.entries.length || !hasDate || saving}
              onClick={save}
            >
              {t('timelineImport.import', { n: result?.entries.length ?? 0 })}
            </button>
            <button type="button" onClick={() => setMapping(null)}>
              {t('readDocumentDialog.back')}
            </button>
            <button type="button" onClick={() => ref.current?.close()}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
