import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { addHealthEntry } from '../db/repo'
import { nowTime, today } from '../health/now'
import { type DetailValue, findPreset, presetOrder, symptomPreset } from '../health/presets'
import { useT } from '../i18n/context'
import type { HealthEntry, Person } from '../types'
import { ConsentForm } from './ConsentForm'
import { DetailFields } from './DetailFields'

/** Choice values that are not a preset id: nothing picked yet, and "something else". */
const NONE = ''
const CUSTOM = 'custom'

/**
 * One line for how someone feels right now: a runny nose, a cough, red eyes, a stool that was
 * not right. Pick the symptom (recently used first) or "something else" and type it — a typed name
 * that is a known symptom or one of its synonyms is saved as that symptom — optionally rate it,
 * fill the symptom's details and add a note, save — date and time are now. A list, not a typed
 * field with suggestions: phone browsers barely show those, and the bar must work the same on both.
 * Anything more (another date, the side of the body) belongs in the full add form.
 */
export function QuickSymptom({
  persons,
  personId: initialPerson,
  entries,
  onSaved,
}: {
  persons: Person[]
  personId: string
  /** The person's log, newest first; only used to order the symptom list. */
  entries: HealthEntry[]
  onSaved: () => void
}) {
  const { db } = useApp()
  const t = useT()
  const [personId, setPersonId] = useState(initialPerson)
  const [choice, setChoice] = useState(NONE)
  const [text, setText] = useState('')
  const [severity, setSeverity] = useState('')
  const [note, setNote] = useState('')
  const [details, setDetails] = useState<Record<string, DetailValue>>({})
  const [consented, setConsented] = useState<boolean | null>(null)
  const [asking, setAsking] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => setPersonId(initialPerson), [initialPerson])
  useEffect(() => {
    setConsented(null)
    if (personId) hasConsent(db, 'import_document', personId).then(setConsented)
  }, [db, personId])

  const order = useMemo(() => presetOrder('symptom', entries), [entries])
  // Typed text is matched against the translated names, then the English titles and synonyms.
  const typed = text.trim().toLowerCase()
  const preset =
    choice === CUSTOM
      ? (order.find((p) => t(`preset.${p.id}`).toLowerCase() === typed) ?? symptomPreset(text))
      : findPreset(choice)
  const name = preset ? t(`preset.${preset.id}`) : choice === CUSTOM ? text.trim() : ''
  const valid = !!personId && name !== ''

  const pick = (v: string) => {
    setChoice(v)
    setText('')
    setDetails({})
    setSaved(null)
  }

  const save = async () => {
    if (!valid) return
    if (consented === false) return setAsking(true)
    await addHealthEntry(db, {
      personId,
      date: today(),
      time: nowTime(),
      kind: 'symptom',
      title: preset ? preset.title : name,
      body: note.trim(),
      bodyPart: preset?.bodyPart ?? '',
      severity: severity === '' ? null : Number(severity),
      tags: preset?.tags ?? [],
      details: preset?.details ? details : {},
    })
    setSaved(name)
    setChoice(NONE)
    setText('')
    setSeverity('')
    setNote('')
    setDetails({})
    await onSaved()
  }

  if (asking)
    return (
      <div className="card inset">
        <ConsentForm
          kind="import_document"
          onCancel={() => setAsking(false)}
          onConfirm={async () => {
            await grantConsent(db, 'import_document', personId)
            setConsented(true)
            setAsking(false)
          }}
        />
      </div>
    )

  return (
    <div className="row quickmeasure">
      <span className="muted">{t('quickSymptom.label')}</span>
      {persons.length > 1 && (
        <select
          aria-label={t('healthPage.colPerson')}
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
        >
          <option value="">{t('healthForm.pickPerson')}</option>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      )}
      <select aria-label={t('quickSymptom.symptom')} value={choice} onChange={(e) => pick(e.target.value)}>
        <option value={NONE}>{t('quickSymptom.symptom')}</option>
        {order.map((p) => (
          <option key={p.id} value={p.id}>
            {t(`preset.${p.id}`)}
          </option>
        ))}
        <option value={CUSTOM}>{t('quick.custom')}</option>
      </select>
      {choice === CUSTOM && (
        <input
          aria-label={t('quickSymptom.symptom')}
          placeholder={t('quickSymptom.placeholder')}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setDetails({})
            setSaved(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      )}
      <select
        aria-label={t('healthLog.severity')}
        value={severity}
        onChange={(e) => setSeverity(e.target.value)}
      >
        <option value="">{t('quickSymptom.severity')}</option>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {t('healthLog.outOfTen', { n })}
          </option>
        ))}
      </select>
      <input
        aria-label={t('quick.note')}
        placeholder={t('quick.note')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <button type="button" className="primary" disabled={!valid || consented === null} onClick={save}>
        {t('quick.save')}
      </button>
      {saved && <span className="ok">{t('quick.saved', { what: saved })}</span>}
      {preset?.details && (
        <div className="row details">
          <DetailFields fields={preset.details} value={details} onChange={setDetails} />
        </div>
      )}
    </div>
  )
}
