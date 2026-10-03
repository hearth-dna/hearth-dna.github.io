import { useState } from 'react'
import type { Database } from '../db/db'
import { rebuildGenomesFromCache } from '../export/restore'
import { useT } from '../i18n/context'

/**
 * In place of the app when the database file is damaged (SQLITE_CORRUPT): what happened, and a
 * repair that keeps whatever can still be read, rebuilds genotypes from the genome files kept on
 * the device, and then reloads. Anything still missing comes back from a backup.
 */
export function RepairScreen({ db, error }: { db: Database; error: string }) {
  const t = useT()
  const [step, setStep] = useState<'ask' | 'working' | 'done' | 'failed'>('ask')
  const [progress, setProgress] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const repair = async () => {
    setStep('working')
    try {
      const { rows, lost } = await db.repair()
      const genomes = await rebuildGenomesFromCache(db, (key, params) => setProgress(t(key, params)))
      setMsg(
        [
          t('repair.done', { people: rows.person ?? 0, entries: rows.health_log ?? 0, genomes }),
          lost.length ? t('repair.lost', { tables: lost.join(', ') }) : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
      setStep('done')
    } catch (e) {
      setMsg(t('repair.failed', { error: e instanceof Error ? e.message : String(e) }))
      setStep('failed')
    }
  }

  return (
    <main>
      <div className="card">
        <h1 className="mt-0">{t('repair.title')}</h1>
        <p>{t('repair.intro')}</p>
        <p className="muted">{error}</p>
        {step === 'ask' && (
          <button type="button" className="primary" onClick={repair}>
            {t('repair.button')}
          </button>
        )}
        {step === 'working' && (
          <p className="activity" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" /> {progress ?? t('repair.working')}
          </p>
        )}
        {(step === 'done' || step === 'failed') && (
          <>
            <p className={step === 'done' ? 'ok' : 'danger'}>{msg}</p>
            <button type="button" className="primary" onClick={() => location.reload()}>
              {t('repair.reload')}
            </button>
          </>
        )}
      </div>
    </main>
  )
}
