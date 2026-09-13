import { useState } from 'react'
import { CONSENTS, type ConsentKind } from '../consent/kinds'

/** One checkbox per statement; the confirm button enables only when all are ticked (design §13.1). */
export function ConsentForm({
  kind,
  onConfirm,
  onCancel,
  confirmLabel = 'I confirm',
}: {
  kind: ConsentKind
  onConfirm: () => void
  onCancel?: () => void
  confirmLabel?: string
}) {
  const c = CONSENTS[kind]
  const [ticked, setTicked] = useState<boolean[]>(c.statements.map(() => false))
  const all = ticked.every(Boolean)
  return (
    <div>
      <h2>{c.title}</h2>
      {c.statements.map((s, i) => (
        <label className="check" key={s}>
          <input
            type="checkbox"
            checked={ticked[i]}
            onChange={(e) => setTicked(ticked.map((t, j) => (j === i ? e.target.checked : t)))}
          />
          <span>{s}</span>
        </label>
      ))}
      <div className="row" style={{ marginTop: '0.8rem' }}>
        <button type="button" className="primary" disabled={!all} onClick={onConfirm}>
          {confirmLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <span className="muted">
          Recorded locally with a timestamp (text v{c.version}). Revocable in Settings.
        </span>
      </div>
    </div>
  )
}
