import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { addHealthEntry, deleteHealthEntry, listHealthLog } from '../db/repo'
import { HEALTH_KIND_LABELS, type HealthEntry, type HealthKind, type Person } from '../types'
import { ConsentForm } from './ConsentForm'
import { ReadDocumentDialog } from './ReadDocumentDialog'

const today = () => new Date().toISOString().slice(0, 10)

/**
 * A person's health log: dated text entries pasted from lab reports, letters, diagnoses or
 * medication lists. Stored locally only; the Ask page offers them for the context pack. Adding the
 * first entry asks for the document consent (design §13.1). PDF/OCR extraction is milestone 3.
 */
export function HealthLog({ person }: { person: Person }) {
  const { db } = useApp()
  const [entries, setEntries] = useState<HealthEntry[]>([])
  const [consented, setConsented] = useState<boolean | null>(null)
  const [adding, setAdding] = useState(false)
  const blank = () => ({ date: today(), kind: 'lab' as HealthKind, title: '', body: '', source: '' })
  const [form, setForm] = useState(blank())
  const [reading, setReading] = useState(false)

  const reload = async () => setEntries(await listHealthLog(db, person.id))
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per db/person
  useEffect(() => {
    reload()
    hasConsent(db, 'import_document', person.id).then(setConsented)
  }, [db, person.id])

  const save = async () => {
    if (!form.title.trim()) return
    await addHealthEntry(db, { personId: person.id, ...form, title: form.title.trim() })
    setForm(blank())
    setAdding(false)
    await reload()
  }

  return (
    <div className="card">
      <h2>Health log</h2>
      <p className="muted">
        Lab results, diagnoses, medications and doctor letters as dated text. Paste the report's numbers or
        wording; it stays on this device and can be included in an Ask context pack.
      </p>
      {entries.length === 0 ? (
        <p className="muted">empty</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              <strong>{e.date}</strong> · {HEALTH_KIND_LABELS[e.kind]} · {e.title}{' '}
              {e.source && (
                <span className="badge" title={e.source}>
                  transcribed by {e.source.split(':')[0]}
                </span>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (confirm(`Delete "${e.title}" (${e.date})?`)) {
                    await deleteHealthEntry(db, e.id)
                    await reload()
                  }
                }}
              >
                delete
              </button>
              {e.body && (
                <details>
                  <summary className="muted">text</summary>
                  <pre className="pack">{e.body}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {!adding ? (
        <div className="row">
          <button type="button" disabled={consented === null} onClick={() => setAdding(true)}>
            Add entry…
          </button>
          <button type="button" disabled={consented === null} onClick={() => setReading(true)}>
            Read a document…
          </button>
        </div>
      ) : !consented ? (
        <ConsentForm
          kind="import_document"
          onCancel={() => setAdding(false)}
          onConfirm={async () => {
            await grantConsent(db, 'import_document', person.id)
            setConsented(true)
          }}
        />
      ) : (
        <div>
          <div className="row">
            <label className="field">
              Date
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label className="field">
              Kind
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as HealthKind })}
              >
                {(Object.keys(HEALTH_KIND_LABELS) as HealthKind[]).map((k) => (
                  <option key={k} value={k}>
                    {HEALTH_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              Title
              <input
                value={form.title}
                placeholder="e.g. Lipid panel, city lab"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
          </div>
          <label className="field" style={{ marginTop: '0.6rem' }}>
            Text (paste the relevant values or wording from the paper)
            <textarea
              value={form.body}
              placeholder={'LDL 4.1 mmol/L (ref < 3.0)\nHDL 1.2 mmol/L (ref > 1.0)'}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>
          {form.source && (
            <p className="muted">
              Transcribed by a model from your document; check every number against the paper before saving.
            </p>
          )}
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button type="button" className="primary" disabled={!form.title.trim()} onClick={save}>
              Save entry
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(blank())
                setAdding(false)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {reading && (
        <ReadDocumentDialog
          person={person}
          onClose={() => setReading(false)}
          onDraft={(d, source) => {
            setForm({ ...d, source })
            setAdding(true)
          }}
        />
      )}
    </div>
  )
}
