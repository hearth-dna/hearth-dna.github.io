import { useState } from 'react'
import { CONSENTS, type ConsentKind } from '../consent/kinds'
import { useT } from '../i18n/context'

/** One checkbox per statement; the confirm button enables only when all are ticked (design §13.1). */
export function ConsentForm({
  kind,
  onConfirm,
  onCancel,
  confirmLabel,
}: {
  kind: ConsentKind
  onConfirm: () => void
  onCancel?: () => void
  confirmLabel?: string
}) {
  const t = useT()
  const c = CONSENTS[kind]
  const [ticked, setTicked] = useState<boolean[]>(c.statements.map(() => false))
  const all = ticked.every(Boolean)
  return (
    <div>
      <h2>{t(c.title)}</h2>
      {c.statements.map((s, i) => (
        <label className="check" key={s}>
          <input
            type="checkbox"
            checked={ticked[i]}
            onChange={(e) => setTicked(ticked.map((t, j) => (j === i ? e.target.checked : t)))}
          />
          <span>{t(s)}</span>
        </label>
      ))}
      <div className="row" style={{ marginTop: '0.8rem' }}>
        <button type="button" className="primary" disabled={!all} onClick={onConfirm}>
          {confirmLabel ?? t('consentForm.confirm')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
        <span className="muted">{t('consentForm.recorded', { version: c.version })}</span>
      </div>
    </div>
  )
}
