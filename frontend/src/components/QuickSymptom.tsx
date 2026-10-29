import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { addHealthEntry } from '../db/repo'
import { nowTime, today } from '../health/now'
import { type DetailValue, type HealthPreset, presetNamed, presetOrder } from '../health/presets'
import { useT } from '../i18n/context'
import type { HealthEntry, Person } from '../types'
import { ConsentForm } from './ConsentForm'
import { DetailFields } from './DetailFields'
import { PresetSearch } from './PresetSearch'
import { WhenInputs } from './WhenInputs'

/**
 * One line for how someone feels right now — a runny nose, a cough, red eyes, a stool that was
 * not right — or for a treatment or checkup they had: teeth cleaning, an eye exam. Search and pick
 * from both lists (recently used first; a name that is a known one or one of its synonyms counts as
 * that preset and decides whether it is a symptom or a procedure, any other text is a custom entry
 * of the kind chosen beside it), optionally rate a symptom, fill its details and add a note, save —
 * date and time are now unless changed. Anything more (the side of the body) belongs in the full
 * add form.
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
  // What custom text is saved as; a preset brings its own kind.
  const [custom, setCustom] = useState<'symptom' | 'procedure'>('symptom')
  const [severity, setSeverity] = useState('')
  const [note, setNote] = useState('')
  // Empty: now, taken when saving.
  const [when, setWhen] = useState({ date: '', time: '' })
  const [details, setDetails] = useState<Record<string, DetailValue>>({})
  const [consented, setConsented] = useState<boolean | null>(null)
  const [asking, setAsking] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => setPersonId(initialPerson), [initialPerson])
  useEffect(() => {
    setConsented(null)
    if (personId) hasConsent(db, 'import_document', personId).then(setConsented)
  }, [db, personId])

  const order = useMemo(() => presetOrder(['symptom', 'procedure'], entries), [entries])
  const shown = (p: HealthPreset) => t(`preset.${p.id}`)
  const preset = presetNamed(order, text, shown)
  const kind = preset ? preset.kind : custom
  const name = preset ? shown(preset) : text.trim()
  const valid = !!personId && name !== ''

  const type = (v: string) => {
    if (presetNamed(order, v, shown) !== preset) setDetails({})
    setText(v)
    setSaved(null)
  }

  const save = async () => {
    if (!valid) return
    if (consented === false) return setAsking(true)
    await addHealthEntry(db, {
      personId,
      date: when.date || today(),
      time: when.date || when.time ? when.time : nowTime(),
      kind,
      title: preset ? preset.title : name,
      body: note.trim(),
      bodyPart: preset?.bodyPart ?? '',
      severity: kind === 'symptom' && severity !== '' ? Number(severity) : null,
      tags: preset?.tags ?? [],
      details: preset?.details ? details : {},
    })
    setSaved(name)
    setText('')
    setSeverity('')
    setNote('')
    setWhen({ date: '', time: '' })
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
      <select
        aria-label={t('healthLog.kind')}
        value={kind}
        disabled={!!preset}
        onChange={(e) => setCustom(e.target.value as 'symptom' | 'procedure')}
      >
        <option value="symptom">{t('kind.symptom')}</option>
        <option value="procedure">{t('kind.procedure')}</option>
      </select>
      <PresetSearch
        presets={order}
        name={shown}
        value={text}
        onChange={type}
        onEnter={save}
        label={t('quickSymptom.symptom')}
        placeholder={t('quickSymptom.placeholder')}
      />
      {kind === 'symptom' && (
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
      )}
      <input
        aria-label={t('quick.note')}
        placeholder={t('quick.note')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <WhenInputs date={when.date || today()} time={when.time || nowTime()} onChange={setWhen} />
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
