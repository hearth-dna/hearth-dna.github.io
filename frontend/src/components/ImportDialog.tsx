import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { useT } from '../i18n/context'
import { importGenomeFile } from '../import/importFile'
import { PROVIDER_LABELS, type Provider } from '../types'
import { ConsentForm } from './ConsentForm'

type Stage =
  | { s: 'consent' }
  | { s: 'pick' }
  | { s: 'working'; msg: string; pct: number }
  | { s: 'done'; msg: string }
  | { s: 'error'; msg: string }

export function ImportDialog({ personId, onClose }: { personId: string; onClose: () => void }) {
  const t = useT()
  const { db, persons, refresh } = useApp()
  const person = persons.find((p) => p.id === personId)!
  const isMinor = person.birthYear !== null && new Date().getFullYear() - person.birthYear < 18
  const ref = useRef<HTMLDialogElement>(null)
  const [stage, setStage] = useState<Stage>({ s: 'consent' })
  const [minorOk, setMinorOk] = useState(!isMinor)
  const [forced, setForced] = useState<Provider | ''>('')

  useEffect(() => {
    ref.current?.showModal()
    hasConsent(db, 'import_genome', personId).then((ok) => ok && setStage({ s: 'pick' }))
  }, [db, personId])

  const run = async (file: File) => {
    try {
      const summary = await importGenomeFile(
        db,
        personId,
        file,
        (p) => setStage({ s: 'working', ...p }),
        t,
        forced || undefined,
      )
      await refresh()
      setStage({ s: 'done', msg: `${summary}.` })
    } catch (e) {
      setStage({ s: 'error', msg: String(e) })
    }
  }

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>{t('importDialog.title', { name: person.displayName })}</h2>
      {stage.s === 'consent' && (
        <div>
          {isMinor && (
            <div className="notice">
              <strong>{t('importDialog.under18')}</strong>
              <label className="check">
                <input type="checkbox" checked={minorOk} onChange={(e) => setMinorOk(e.target.checked)} />
                <span>{t('importDialog.guardianStatement')}</span>
              </label>
            </div>
          )}
          <ConsentForm
            kind="import_genome"
            onCancel={() => ref.current?.close()}
            onConfirm={async () => {
              if (!minorOk) return
              await grantConsent(db, 'import_genome', personId)
              if (isMinor) await grantConsent(db, 'import_minor', personId)
              setStage({ s: 'pick' })
            }}
          />
        </div>
      )}
      {stage.s === 'pick' && (
        <div>
          <p className="muted">{t('importDialog.accepted')}</p>
          <label className="field">
            {t('importDialog.provider')}
            <select value={forced} onChange={(e) => setForced(e.target.value as Provider | '')}>
              <option value="">{t('importDialog.autoDetect')}</option>
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <p>
            <input
              type="file"
              accept=".txt,.csv,.vcf,.zip,.gz,.tsv"
              onChange={(e) => e.target.files?.[0] && run(e.target.files[0])}
            />
          </p>
          <button type="button" onClick={() => ref.current?.close()}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      {stage.s === 'working' && (
        <div>
          <p>{stage.msg}</p>
          <progress value={stage.pct} max={100} />
        </div>
      )}
      {stage.s === 'done' && (
        <div>
          <p className="ok">{stage.msg}</p>
          <button type="button" className="primary" onClick={() => ref.current?.close()}>
            {t('common.close')}
          </button>
        </div>
      )}
      {stage.s === 'error' && (
        <div>
          <p className="danger">{stage.msg}</p>
          <button type="button" onClick={() => setStage({ s: 'pick' })}>
            {t('importDialog.tryAgain')}
          </button>
        </div>
      )}
    </dialog>
  )
}
