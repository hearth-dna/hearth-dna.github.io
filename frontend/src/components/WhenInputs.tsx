import { useState } from 'react'
import { useT } from '../i18n/context'
import type { HealthEntry } from '../types'

/**
 * Date and time of an entry, as two inputs. Empty means "now" where the caller says so: the quick
 * bars show the current moment and take it at the time of saving, so a bar left open stays current.
 */
export function WhenInputs({
  date,
  time,
  onChange,
}: {
  date: string
  time: string
  onChange: (when: { date: string; time: string }) => void
}) {
  const t = useT()
  return (
    <>
      <input
        type="date"
        aria-label={t('healthLog.date')}
        value={date}
        onChange={(e) => onChange({ date: e.target.value, time })}
      />
      <input
        type="time"
        aria-label={t('healthForm.time')}
        value={time}
        onChange={(e) => onChange({ date, time: e.target.value })}
      />
    </>
  )
}

/** An entry's date and time, changed in place (the health log's open entry). */
export function EditWhen({
  entry,
  onSave,
}: {
  entry: HealthEntry
  onSave: (date: string, time: string) => void
}) {
  const t = useT()
  const [when, setWhen] = useState({ date: entry.date, time: entry.time })
  const changed = when.date !== entry.date || when.time !== entry.time
  return (
    <div className="row">
      <WhenInputs date={when.date} time={when.time} onChange={setWhen} />
      <button
        type="button"
        className="small"
        disabled={!changed || !when.date}
        onClick={() => onSave(when.date, when.time)}
      >
        {t('common.save')}
      </button>
    </div>
  )
}
