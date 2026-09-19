import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { addHealthEntry } from '../db/repo'
import { formatValue } from '../health/log'
import { findPreset, type HealthPreset, measurementOrder } from '../health/presets'
import { useT } from '../i18n/context'
import type { HealthEntry, Person } from '../types'
import { ConsentForm } from './ConsentForm'

const pad = (n: number) => String(n).padStart(2, '0')
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const nowTime = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const CUSTOM = ''

/**
 * One line for the numbers people record over and over: weight, height, blood pressure, waist,
 * steps… Pick the parameter, type the number, save — date and time are now, the unit comes from
 * the preset. Anything more (a note, another date, a symptom) belongs in the full add form.
 * Parameters this person already uses come first.
 */
export function QuickMeasurement({
  persons,
  personId: initialPerson,
  entries,
  onSaved,
}: {
  persons: Person[]
  personId: string
  /** The person's log, newest first; only used to order the parameter list. */
  entries: HealthEntry[]
  onSaved: () => void
}) {
  const { db } = useApp()
  const t = useT()
  const [personId, setPersonId] = useState(initialPerson)
  const [presetId, setPresetId] = useState(measurementOrder(entries)[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [unit, setUnit] = useState('')
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')
  const [consented, setConsented] = useState<boolean | null>(null)
  const [asking, setAsking] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => setPersonId(initialPerson), [initialPerson])
  useEffect(() => {
    setConsented(null)
    if (personId) hasConsent(db, 'import_document', personId).then(setConsented)
  }, [db, personId])

  const preset: HealthPreset | undefined = findPreset(presetId)
  const pair = preset?.pair
  const numeric = (s: string) => s.trim() !== '' && Number.isFinite(Number(s))
  const finalTitle = preset ? preset.title : title.trim()
  const finalUnit = preset ? (preset.unit ?? '') : unit.trim()
  const valid = !!personId && finalTitle !== '' && numeric(value) && (!pair || numeric(value2))

  const save = async () => {
    if (!valid) return
    if (consented === false) return setAsking(true)
    const entry = {
      personId,
      date: today(),
      time: nowTime(),
      kind: 'measurement' as const,
      title: finalTitle,
      body: '',
      source: '',
      bodyPart: preset?.bodyPart ?? '',
      severity: null,
      tags: preset?.tags ?? [],
      value: Number(value),
      value2: pair ? Number(value2) : null,
      unit: finalUnit,
    }
    await addHealthEntry(db, entry)
    setSaved(`${finalTitle} ${formatValue({ value: entry.value, value2: entry.value2, unit: finalUnit })}`)
    setValue('')
    setValue2('')
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
      <span className="muted">{t('quick.label')}</span>
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
        aria-label={t('quick.parameter')}
        value={presetId}
        onChange={(e) => {
          setPresetId(e.target.value)
          setValue('')
          setValue2('')
        }}
      >
        {measurementOrder(entries).map((p) => (
          <option key={p.id} value={p.id}>
            {t(`preset.${p.id}`)}
          </option>
        ))}
        <option value={CUSTOM}>{t('quick.custom')}</option>
      </select>
      {!preset && (
        <input
          aria-label={t('healthLog.titleField')}
          placeholder={t('quick.customPlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      )}
      <input
        aria-label={
          pair ? t('healthLog.valueOf', { label: t(`preset.pair.${pair[0]}`) }) : t('healthLog.value')
        }
        type="number"
        inputMode="decimal"
        step={preset?.step ?? 'any'}
        placeholder={pair ? t(`preset.pair.${pair[0]}`) : t('healthLog.value')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      {pair && (
        <input
          aria-label={t('healthLog.valueOf', { label: t(`preset.pair.${pair[1]}`) })}
          type="number"
          inputMode="decimal"
          step={preset?.step ?? 'any'}
          placeholder={t(`preset.pair.${pair[1]}`)}
          value={value2}
          onChange={(e) => setValue2(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      )}
      {preset ? (
        <span className="muted">{preset.unit}</span>
      ) : (
        <input
          aria-label={t('healthLog.unit')}
          placeholder={t('healthLog.unitPlaceholder')}
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          style={{ width: '6rem' }}
        />
      )}
      <button type="button" className="primary" disabled={!valid || consented === null} onClick={save}>
        {t('quick.save')}
      </button>
      {saved && <span className="ok">{t('quick.saved', { what: saved })}</span>}
    </div>
  )
}
