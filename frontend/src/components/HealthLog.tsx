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
import { useT } from '../i18n/context'
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
  const t = useT()
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
      <h2>{t('healthLog.title')}</h2>
      <p className="muted">{t('healthLog.intro')}</p>
      {entries.length > 0 && (
        <div className="row filters">
          <select
            aria-label={t('healthLog.filterKind')}
            value={filter.kind}
            onChange={(e) => setFilter({ ...filter, kind: e.target.value as HealthKind | '' })}
          >
            <option value="">{t('healthLog.anyKind')}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('healthLog.filterBodyPart')}
            value={filter.bodyPart}
            disabled={bodyParts.length === 0}
            onChange={(e) => setFilter({ ...filter, bodyPart: e.target.value })}
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
            onChange={(e) => setFilter({ ...filter, tag: e.target.value })}
          >
            <option value="">{t('healthLog.anyTag')}</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder={t('healthLog.searchText')}
            value={filter.text}
            onChange={(e) => setFilter({ ...filter, text: e.target.value })}
          />
          {filtering && (
            <button type="button" className="small" onClick={() => setFilter(NO_FILTER)}>
              {t('common.clear')}
            </button>
          )}
          <span className="muted">{t('healthLog.shownOf', { n: shown.length, m: entries.length })}</span>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="muted">{t('common.empty')}</p>
      ) : shown.length === 0 ? (
        <p className="muted">{t('healthLog.nothingMatches')}</p>
      ) : (
        <ul>
          {shown.map((e) => (
            <li key={e.id}>
              {describeEntry(e)}{' '}
              {e.source && (
                <span className="badge" title={e.source}>
                  {t('healthLog.transcribedBy', { model: e.source.split(':')[0] })}
                </span>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (confirm(t('healthLog.confirmDelete', { title: e.title, date: e.date }))) {
                    await deleteHealthEntry(db, e.id)
                    await reload()
                  }
                }}
              >
                {t('common.delete')}
              </button>
              {e.body && (
                <details>
                  <summary className="muted">{t('healthLog.text')}</summary>
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
            {t('healthLog.addEntry')}
          </button>
          <button type="button" disabled={consented === null} onClick={() => setReading(true)}>
            {t('healthLog.readDocument')}
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
              {t('healthLog.startFrom')}
              <select value={form.preset} onChange={(e) => applyPreset(e.target.value)}>
                <option value="">{t('healthLog.customEntry')}</option>
                {PRESET_GROUPS.map((g) => (
                  <optgroup key={g.label} label={t(g.labelKey)}>
                    {g.presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {t(`preset.${p.id}`)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field">
              {t('healthLog.date')}
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label className="field">
              {t('healthLog.kind')}
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as HealthKind })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              {t('healthLog.titleField')}
              <input
                value={form.title}
                placeholder={
                  form.kind === 'symptom'
                    ? t('healthLog.titlePlaceholderSymptom')
                    : measuring
                      ? t('healthLog.titlePlaceholderMeasurement')
                      : t('healthLog.titlePlaceholderOther')
                }
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
          </div>
          {measuring && (
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <label className="field">
                {pair ? t('healthLog.valueOf', { label: t(`preset.pair.${pair[0]}`) }) : t('healthLog.value')}
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
                  {t('healthLog.valueOf', { label: t(`preset.pair.${pair[1]}`) })}
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
                {t('healthLog.unit')}
                <input
                  value={form.unit}
                  placeholder={t('healthLog.unitPlaceholder')}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </label>
            </div>
          )}
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <label className="field">
              {t('healthLog.bodyPart')}
              <input
                list="body-parts"
                value={form.bodyPart}
                placeholder={t('healthLog.bodyPartPlaceholder')}
                onChange={(e) => setForm({ ...form, bodyPart: e.target.value })}
              />
              <datalist id="body-parts">
                {BODY_PARTS.map((b) => (
                  <option key={b} value={b} label={t(`bodyPart.${b}`)} />
                ))}
              </datalist>
            </label>
            <label className="field">
              {measuring ? t('healthLog.howItFelt') : t('healthLog.severity')}
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="">{t('healthLog.notRated')}</option>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {t('healthLog.outOfTen', { n })}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              {t('healthLog.tags')}
              <input
                list="health-tags"
                value={form.tags}
                placeholder={t('healthLog.tagsPlaceholder')}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
              <datalist id="health-tags">
                {tags.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="field" style={{ marginTop: '0.6rem' }}>
            {form.kind === 'symptom'
              ? t('healthLog.detailsSymptom')
              : measuring
                ? t('healthLog.detailsMeasurement')
                : t('healthLog.detailsOther')}
            <textarea
              value={form.body}
              placeholder={
                form.kind === 'symptom'
                  ? t('healthLog.bodyPlaceholderSymptom')
                  : measuring
                    ? t('healthLog.bodyPlaceholderMeasurement')
                    : t('healthLog.bodyPlaceholderOther')
              }
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>
          {form.source && <p className="muted">{t('healthLog.transcribedNotice')}</p>}
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button type="button" className="primary" disabled={!valid} onClick={save}>
              {t('healthLog.saveEntry')}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(blank())
                setAdding(false)
              }}
            >
              {t('common.cancel')}
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
