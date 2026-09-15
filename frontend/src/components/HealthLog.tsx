import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { addHealthEntry, deleteHealthEntry, listHealthLog } from '../db/repo'
import {
  describeEntry,
  facets,
  filterHealthLog,
  type HealthFilter,
  NO_FILTER,
  parseTags,
} from '../health/log'
import { findPreset, type HealthPreset, PRESET_GROUPS } from '../health/presets'
import { BODY_PARTS, HEALTH_KIND_LABELS, type HealthEntry, type HealthKind, type Person } from '../types'
import { ConsentForm } from './ConsentForm'
import { ReadDocumentDialog } from './ReadDocumentDialog'

const today = () => new Date().toISOString().slice(0, 10)
const KINDS = Object.keys(HEALTH_KIND_LABELS) as HealthKind[]

/**
 * A person's health log: dated entries — symptoms the person noticed themselves, or text pasted
 * from lab reports, letters, diagnoses and medication lists. Every entry can carry a body part,
 * a severity and tags (conditions, diseases) so the log can be filtered later. Measurements
 * (temperature, blood pressure, weight…) store numbers with a unit. A preset list prefills the
 * common situations; anything can also be typed by hand. Stored locally only;
 * the Ask page offers entries for the context pack. Adding the first entry asks for the document
 * consent (design §13.1). PDF/OCR extraction is milestone 3.
 */
export function HealthLog({ person }: { person: Person }) {
  const { db } = useApp()
  const [entries, setEntries] = useState<HealthEntry[]>([])
  const [consented, setConsented] = useState<boolean | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<HealthFilter>(NO_FILTER)
  const blank = () => ({
    date: today(),
    kind: 'symptom' as HealthKind,
    title: '',
    body: '',
    source: '',
    bodyPart: '',
    severity: '' as string,
    tags: '',
    value: '',
    value2: '',
    unit: '',
    preset: '',
  })
  const [form, setForm] = useState(blank())
  const preset: HealthPreset | undefined = findPreset(form.preset)
  const measuring = form.kind === 'measurement'
  const pair = measuring && preset?.pair
  const numeric = (s: string) => s.trim() !== '' && Number.isFinite(Number(s))
  const valid =
    form.title.trim() !== '' && (!measuring || (numeric(form.value) && (!pair || numeric(form.value2))))

  const applyPreset = (id: string) => {
    const p = findPreset(id)
    if (!p) return setForm({ ...form, preset: '' })
    setForm({
      ...form,
      preset: id,
      kind: p.kind,
      title: p.title,
      bodyPart: p.bodyPart ?? '',
      tags: p.tags?.join(', ') ?? '',
      unit: p.unit ?? '',
      value: '',
      value2: '',
    })
  }
  const [reading, setReading] = useState(false)

  const reload = async () => setEntries(await listHealthLog(db, person.id))
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per db/person
  useEffect(() => {
    reload()
    hasConsent(db, 'import_document', person.id).then(setConsented)
  }, [db, person.id])

  const { bodyParts, tags } = useMemo(() => facets(entries), [entries])
  const shown = useMemo(() => filterHealthLog(entries, filter), [entries, filter])
  const filtering = Object.values(filter).some(Boolean)

  const save = async () => {
    if (!valid) return
    await addHealthEntry(db, {
      personId: person.id,
      date: form.date,
      kind: form.kind,
      title: form.title.trim(),
      body: form.body,
      source: form.source,
      bodyPart: form.bodyPart,
      severity: form.severity === '' ? null : Number(form.severity),
      tags: parseTags(form.tags),
      value: measuring ? Number(form.value) : null,
      value2: pair ? Number(form.value2) : null,
      unit: measuring ? form.unit : '',
    })
    setForm(blank())
    setAdding(false)
    await reload()
  }

  return (
    <div className="card">
      <h2>Health log</h2>
      <p className="muted">
        How you feel (a symptom, where and how bad), numbers you measure at home (temperature, blood pressure,
        weight) and dated text from lab results, diagnoses, medications and doctor letters. It stays on this
        device and can be included in an Ask context pack.
      </p>
      {entries.length > 0 && (
        <div className="row filters">
          <select
            aria-label="Kind"
            value={filter.kind}
            onChange={(e) => setFilter({ ...filter, kind: e.target.value as HealthKind | '' })}
          >
            <option value="">any kind</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {HEALTH_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            aria-label="Body part"
            value={filter.bodyPart}
            disabled={bodyParts.length === 0}
            onChange={(e) => setFilter({ ...filter, bodyPart: e.target.value })}
          >
            <option value="">any body part</option>
            {bodyParts.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            aria-label="Tag"
            value={filter.tag}
            disabled={tags.length === 0}
            onChange={(e) => setFilter({ ...filter, tag: e.target.value })}
          >
            <option value="">any tag</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="search text"
            value={filter.text}
            onChange={(e) => setFilter({ ...filter, text: e.target.value })}
          />
          {filtering && (
            <button type="button" className="small" onClick={() => setFilter(NO_FILTER)}>
              clear
            </button>
          )}
          <span className="muted">
            {shown.length} of {entries.length}
          </span>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="muted">empty</p>
      ) : shown.length === 0 ? (
        <p className="muted">nothing matches</p>
      ) : (
        <ul>
          {shown.map((e) => (
            <li key={e.id}>
              {describeEntry(e)}{' '}
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
              Start from
              <select value={form.preset} onChange={(e) => applyPreset(e.target.value)}>
                <option value="">custom entry</option>
                {PRESET_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
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
                {KINDS.map((k) => (
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
                placeholder={
                  form.kind === 'symptom'
                    ? 'e.g. Aching in both hands since morning'
                    : measuring
                      ? 'e.g. Waist circumference'
                      : 'e.g. Lipid panel, city lab'
                }
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
          </div>
          {measuring && (
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <label className="field">
                {pair ? `Value (${pair[0]})` : 'Value'}
                <input
                  type="number"
                  inputMode="decimal"
                  step={preset?.step ?? 'any'}
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              </label>
              {pair && (
                <label className="field">
                  Value ({pair[1]})
                  <input
                    type="number"
                    inputMode="decimal"
                    step={preset?.step ?? 'any'}
                    value={form.value2}
                    onChange={(e) => setForm({ ...form, value2: e.target.value })}
                  />
                </label>
              )}
              <label className="field">
                Unit
                <input
                  value={form.unit}
                  placeholder="e.g. cm"
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </label>
            </div>
          )}
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <label className="field">
              Body part
              <input
                list="body-parts"
                value={form.bodyPart}
                placeholder="e.g. hands"
                onChange={(e) => setForm({ ...form, bodyPart: e.target.value })}
              />
              <datalist id="body-parts">
                {BODY_PARTS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
            <label className="field">
              {measuring ? 'How it felt' : 'Severity'}
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="">not rated</option>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} / 10
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              Tags (conditions, diseases; comma-separated)
              <input
                list="health-tags"
                value={form.tags}
                placeholder="e.g. arthritis, flare"
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
              <datalist id="health-tags">
                {tags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="field" style={{ marginTop: '0.6rem' }}>
            {form.kind === 'symptom'
              ? 'Details (when it started, what makes it better or worse, what you took)'
              : measuring
                ? 'Details (time of day, before or after a meal, which arm, what device)'
                : 'Text (paste the relevant values or wording from the paper)'}
            <textarea
              value={form.body}
              placeholder={
                form.kind === 'symptom'
                  ? 'Started after waking up, both hands stiff for about an hour, better after warm water.'
                  : measuring
                    ? 'Morning, seated, left arm, after five minutes of rest.'
                    : 'LDL 4.1 mmol/L (ref < 3.0)\nHDL 1.2 mmol/L (ref > 1.0)'
              }
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>
          {form.source && (
            <p className="muted">
              Transcribed by a model from your document; check every number against the paper before saving.
            </p>
          )}
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button type="button" className="primary" disabled={!valid} onClick={save}>
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
            setForm({ ...blank(), ...d, source })
            setAdding(true)
          }}
        />
      )}
    </div>
  )
}
