import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { addAttachment, requestPersistence } from '../attachments/store'
import { grantConsent, hasConsent } from '../consent/consent'
import { addHealthEntry } from '../db/repo'
import type { HealthDraft } from '../documents/draft'
import { localDate, parseTags } from '../health/log'
import { findPreset, presetsFor } from '../health/presets'
import { useT } from '../i18n/context'
import { BODY_PARTS, HEALTH_KIND_LABELS, type HealthKind, type Person } from '../types'
import { AttachmentPicker } from './AttachmentPicker'
import { ConsentForm } from './ConsentForm'

const pad = (n: number) => String(n).padStart(2, '0')
const nowTime = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** Kinds usually recorded as they happen; the others mostly come from paper with no time on it. */
const TIMED: ReadonlySet<HealthKind> = new Set(['symptom', 'measurement', 'medication'])
const KINDS = Object.keys(HEALTH_KIND_LABELS) as HealthKind[]

/** Which optional fields each type of entry shows; title, date, tags and text are always there. */
const FIELDS: Record<HealthKind, { value?: true; bodyPart?: true; severity?: true }> = {
  symptom: { bodyPart: true, severity: true },
  measurement: { value: true, bodyPart: true },
  lab: {},
  imaging: { bodyPart: true },
  diagnosis: { bodyPart: true },
  medication: {},
  letter: {},
  other: { bodyPart: true, severity: true },
}

const blank = (kind: HealthKind | null) => ({
  date: localDate(),
  time: kind && TIMED.has(kind) ? nowTime() : '',
  kind,
  title: '',
  body: '',
  source: '',
  bodyPart: '',
  severity: '',
  tags: '',
  value: '',
  value2: '',
  unit: '',
  preset: '',
})

/**
 * Add one health-log entry. The user first picks what it is (symptom, measurement, lab result,
 * medication…); the form then shows only the fields that make sense for that type, with that
 * type's presets as one-click chips. On the family page a person picker comes first. Saving for a
 * person the first time asks for the document consent (design §13.1).
 */
export function HealthEntryForm({
  persons,
  personId: initialPerson,
  draft,
  tagSuggestions,
  onSaved,
  onCancel,
}: {
  persons: Person[]
  personId: string
  /** Prefill from a document reader; skips the type picker. `files` are its pages, to keep. */
  draft?: { draft: HealthDraft; source: string; files?: File[] }
  tagSuggestions: string[]
  onSaved: () => void
  onCancel: () => void
}) {
  const { db } = useApp()
  const t = useT()
  const [personId, setPersonId] = useState(initialPerson)
  const [consented, setConsented] = useState<boolean | null>(null)
  const [form, setForm] = useState(() =>
    draft ? { ...blank(null), ...draft.draft, source: draft.source } : blank(null),
  )
  const [staged, setStaged] = useState<File[]>(draft?.files ?? [])
  const [failed, setFailed] = useState<string[]>([])

  useEffect(() => {
    setConsented(null)
    if (personId) hasConsent(db, 'import_document', personId).then(setConsented)
  }, [db, personId])

  const kind = form.kind
  const fields = kind ? FIELDS[kind] : {}
  const preset = findPreset(form.preset)
  const pair = kind === 'measurement' ? preset?.pair : undefined
  const numeric = (s: string) => s.trim() !== '' && Number.isFinite(Number(s))
  const valid =
    !!personId &&
    !!kind &&
    form.title.trim() !== '' &&
    (!fields.value || (numeric(form.value) && (!pair || numeric(form.value2))))

  const applyPreset = (id: string) => {
    const p = findPreset(id)
    if (!p || form.preset === id) return setForm({ ...form, preset: '' })
    setForm({
      ...form,
      preset: id,
      kind: p.kind,
      title: p.title,
      bodyPart: p.bodyPart ?? form.bodyPart,
      tags: p.tags?.join(', ') ?? form.tags,
      unit: p.unit ?? '',
      value: '',
      value2: '',
    })
  }

  const save = async () => {
    if (!valid || !kind) return
    const entry = await addHealthEntry(db, {
      personId,
      date: form.date,
      time: form.time,
      kind,
      title: form.title.trim(),
      body: form.body,
      source: form.source,
      bodyPart: fields.bodyPart ? form.bodyPart.trim() : '',
      severity: fields.severity && form.severity !== '' ? Number(form.severity) : null,
      tags: parseTags(form.tags),
      value: fields.value ? Number(form.value) : null,
      value2: pair ? Number(form.value2) : null,
      unit: fields.value ? form.unit.trim() : '',
    })
    if (staged.length > 0) {
      await requestPersistence(db)
      const bad: string[] = []
      for (const [i, file] of staged.entries()) {
        // A file that will not store must not cost the user the text they just typed.
        try {
          await addAttachment(db, entry.id, personId, file, i)
        } catch {
          bad.push(file.name)
        }
      }
      if (bad.length > 0) {
        setFailed(bad)
        setStaged([])
        return
      }
    }
    onSaved()
  }

  const personPicker = persons.length > 1 && (
    <label className="field">
      {t('healthPage.colPerson')}
      <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
        <option value="">{t('healthForm.pickPerson')}</option>
        {persons.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </select>
    </label>
  )

  if (personId && consented === false)
    return (
      <div className="card inset">
        {personPicker}
        <ConsentForm
          kind="import_document"
          onCancel={onCancel}
          onConfirm={async () => {
            await grantConsent(db, 'import_document', personId)
            setConsented(true)
          }}
        />
      </div>
    )

  if (!kind)
    return (
      <div className="card inset">
        <h3>{t('healthForm.whatToAdd')}</h3>
        {personPicker}
        <div className="kindpicker">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() =>
                setForm({ ...form, kind: k, time: form.time || (TIMED.has(k) ? nowTime() : '') })
              }
            >
              <strong>{t(`kind.${k}`)}</strong>
              <span className="muted">{t(`healthForm.hint.${k}`)}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    )

  const presets = presetsFor(kind)
  return (
    <div className="card inset">
      <div className="row">
        <h3 style={{ margin: 0 }}>{t('healthForm.newEntry', { kind: t(`kind.${kind}`) })}</h3>
        {!draft && (
          <button
            type="button"
            className="small"
            onClick={() => setForm({ ...blank(null), date: form.date, time: form.time })}
          >
            {t('healthForm.changeType')}
          </button>
        )}
      </div>
      {presets.length > 0 && (
        <div className="row presets">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`tag${form.preset === p.id ? ' active' : ''}`}
              onClick={() => applyPreset(p.id)}
            >
              {t(`preset.${p.id}`)}
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: '0.6rem' }}>
        {personPicker}
        <label className="field">
          {t('healthLog.date')}
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </label>
        <label className="field">
          {t('healthForm.time')}
          <span className="row inline">
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
            <button
              type="button"
              className="small"
              title={t('healthForm.nowHint')}
              onClick={() => setForm({ ...form, date: localDate(), time: nowTime() })}
            >
              {t('healthForm.now')}
            </button>
          </span>
        </label>
        <label className="field" style={{ flex: 1 }}>
          {t(`healthForm.title.${kind}`)}
          <input
            value={form.title}
            placeholder={t(`healthForm.titlePlaceholder.${kind}`)}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
      </div>
      {fields.value && (
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
        {fields.bodyPart && (
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
        )}
        {fields.severity && (
          <label className="field">
            {t('healthLog.severity')}
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              <option value="">{t('healthLog.notRated')}</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {t('healthLog.outOfTen', { n })}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field" style={{ flex: 1 }}>
          {t('healthLog.tags')}
          <input
            list="health-tags"
            value={form.tags}
            placeholder={t('healthLog.tagsPlaceholder')}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
          <datalist id="health-tags">
            {tagSuggestions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </label>
      </div>
      <label className="field" style={{ marginTop: '0.6rem' }}>
        {t(`healthForm.details.${kind}`)}
        <textarea
          value={form.body}
          placeholder={t(`healthForm.bodyPlaceholder.${kind}`)}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
      </label>
      <AttachmentPicker
        files={staged}
        onChange={setStaged}
        disabled={!db.persistent}
        notice={db.persistent ? undefined : t('attachments.notPersistent')}
      />
      {failed.map((name) => (
        <p key={name} className="muted">
          {t('attachments.saveFailed', { name })}
        </p>
      ))}
      {form.source && <p className="muted">{t('healthLog.transcribedNotice')}</p>}
      <div className="row" style={{ marginTop: '0.6rem' }}>
        <button type="button" className="primary" disabled={!valid || consented !== true} onClick={save}>
          {t('healthLog.saveEntry')}
        </button>
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
