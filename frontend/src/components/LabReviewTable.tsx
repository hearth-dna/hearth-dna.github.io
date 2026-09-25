import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { addHealthEntry } from '../db/repo'
import { useI18n, useT } from '../i18n/context'
import { normaliseRow } from '../labs/normalise'
import { labEntries, labTitle } from '../labs/save'
import type { LabReportDraft, RawLabRow } from '../labs/types'
import type { Person } from '../types'
import { ConsentForm } from './ConsentForm'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Editable extends RawLabRow {
  /** Stable React key: the row's place in the report as read. */
  id: string
  /** The user picked the test by hand. */
  pinned: boolean
  include: boolean
}

/**
 * Review of a read lab report before anything is saved: one row per printed result, every field
 * editable, the test chosen from the catalogue. Rows the reader was unsure about (unknown test or
 * unit, a value that cannot be right) are highlighted and left out until ticked. Saving writes one
 * `lab` entry per ticked row.
 */
export function LabReviewTable({
  person,
  draft,
  source,
  onSaved,
  onCancel,
}: {
  person: Person
  draft: LabReportDraft
  source: string
  onSaved: () => void
  onCancel: () => void
}) {
  const { db, kb } = useApp()
  const { lang } = useI18n()
  const t = useT()
  const [consented, setConsented] = useState<boolean | null>(null)
  const [date, setDate] = useState(draft.date || today())
  const [time, setTime] = useState(draft.time)
  const [rows, setRows] = useState<Editable[]>(() =>
    draft.rows.map((r, n) => ({
      id: `row-${n}`,
      name: r.printedName,
      value: r.printedValue,
      unit: r.printedUnit,
      ref: r.printedRef,
      flag: r.printedFlag,
      section: r.section,
      analyte: r.analyte ?? undefined,
      pinned: false,
      include: r.issues.length === 0,
    })),
  )

  useEffect(() => {
    hasConsent(db, 'import_document', person.id).then(setConsented)
  }, [db, person.id])

  const read = useMemo(() => rows.map((r) => normaliseRow(kb, r, r.pinned)), [kb, rows])
  const tests = useMemo(
    () =>
      kb.analytes
        .map((a) => ({ id: a.id, name: a.names[lang] ?? a.names.en }))
        .sort((a, b) => a.name.localeCompare(b.name, lang)),
    [kb, lang],
  )
  const set = (i: number, patch: Partial<Editable>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const chosen = read.filter((_, i) => rows[i].include)

  const save = async () => {
    const entries = labEntries(kb, { ...draft, date, time }, chosen, {
      personId: person.id,
      source,
      lang,
      fallbackDate: today(),
    })
    for (const e of entries) await addHealthEntry(db, e)
    onSaved()
  }

  if (consented === false)
    return (
      <div className="card inset">
        <ConsentForm
          kind="import_document"
          onCancel={onCancel}
          onConfirm={async () => {
            await grantConsent(db, 'import_document', person.id)
            setConsented(true)
          }}
        />
      </div>
    )

  return (
    <div className="card inset">
      <h3 style={{ marginTop: 0 }}>{t('labReview.title', { n: read.length })}</h3>
      <p className="muted">{t('labReview.intro')}</p>
      <div className="row">
        <label className="field">
          {t('healthLog.date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          {t('healthForm.time')}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <div className="tablewrap">
        <table className="healthtable labreview">
          <thead>
            <tr>
              <th>{t('labReview.colSave')}</th>
              <th>{t('labReview.colTest')}</th>
              <th>{t('labReview.colValue')}</th>
              <th>{t('healthLog.unit')}</th>
              <th>{t('labReview.colRef')}</th>
              <th>{t('labReview.colFlag')}</th>
            </tr>
          </thead>
          <tbody>
            {read.map((r, i) => (
              <tr key={rows[i].id} className={r.issues.length ? 'check' : ''}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t('labReview.colSave')}
                    checked={rows[i].include}
                    onChange={(e) => set(i, { include: e.target.checked })}
                  />
                </td>
                <td>
                  <select
                    aria-label={t('labReview.colTest')}
                    value={r.analyte ?? ''}
                    onChange={(e) => set(i, { analyte: e.target.value || undefined, pinned: true })}
                  >
                    <option value="">{t('labReview.notRecognised')}</option>
                    {tests.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  {labTitle(kb, r, lang) !== r.printedName && <div className="muted">{r.printedName}</div>}
                  {r.issues.map((x) => (
                    <div key={x} className="danger">
                      {t(`labReview.issue.${x}`)}
                    </div>
                  ))}
                </td>
                <td>
                  <input
                    aria-label={t('labReview.colValue')}
                    size={7}
                    value={rows[i].value}
                    onChange={(e) => set(i, { value: e.target.value })}
                  />
                  {r.canonical && r.canonical.unit !== r.unit && (
                    <div className="muted">
                      = {Number(r.canonical.value.toPrecision(4))} {r.canonical.unit}
                    </div>
                  )}
                </td>
                <td>
                  <input
                    aria-label={t('healthLog.unit')}
                    size={8}
                    value={rows[i].unit ?? ''}
                    onChange={(e) => set(i, { unit: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={t('labReview.colRef')}
                    size={10}
                    value={rows[i].ref ?? ''}
                    onChange={(e) => set(i, { ref: e.target.value })}
                  />
                </td>
                <td>{r.flag === 'H' ? '↑' : r.flag === 'L' ? '↓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: '0.8rem' }}>
        <button type="button" className="primary" disabled={chosen.length === 0} onClick={save}>
          {t('labReview.save', { n: chosen.length })}
        </button>
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
