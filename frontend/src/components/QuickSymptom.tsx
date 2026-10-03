import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { addHealthEntry } from '../db/repo'
import { nowTime, today } from '../health/now'
import { type DetailValue, presetOrder } from '../health/presets'
import { useT } from '../i18n/context'
import type { HealthEntry, Person } from '../types'
import { ConsentForm } from './ConsentForm'
import { DetailFields } from './DetailFields'

/**
 * One line for how someone feels right now: a runny nose, a cough, red eyes, a stool that was
 * not right. Type or pick the symptom (recently used first; any other text is a custom symptom),
 * optionally rate it and fill the symptom's details, save — date and time are now. Anything more
 * (another date, a note, the side of the body) belongs in the full add form.
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
  const [text, setText] = useState('')
  const [severity, setSeverity] = useState('')
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
  // The typed text is matched against the translated names, then the English titles.
  const typed = text.trim().toLowerCase()
  const preset = order.find(
    (p) => t(`preset.${p.id}`).toLowerCase() === typed || p.title.toLowerCase() === typed,
  )
  const name = preset ? t(`preset.${preset.id}`) : text.trim()
  const valid = !!personId && name !== ''

  const pick = (v: string) => {
    setText(v)
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
      body: '',
      bodyPart: preset?.bodyPart ?? '',
      severity: severity === '' ? null : Number(severity),
      tags: preset?.tags ?? [],
      details: preset?.details ? details : {},
    })
    setSaved(name)
    setText('')
    setSeverity('')
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
      <input
        list="quick-symptoms"
        aria-label={t('quickSymptom.symptom')}
        placeholder={t('quickSymptom.placeholder')}
        value={text}
        onChange={(e) => pick(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <datalist id="quick-symptoms">
        {order.map((p) => (
          <option key={p.id} value={t(`preset.${p.id}`)} />
        ))}
      </datalist>
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
