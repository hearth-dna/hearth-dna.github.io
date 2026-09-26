import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent } from '../consent/consent'
import { addPerson } from '../db/repo'
import { rich, useT } from '../i18n/context'
import { importGenomeFile, personFromFileName } from '../import/importFile'
import { PROVIDER_LABELS, type Provider } from '../types'
import { ConsentForm } from './ConsentForm'

interface Row {
  file: File
  status: 'queued' | 'working' | 'done' | 'error'
  msg: string
  pct: number
}

/**
 * Several raw-data files at once. Each becomes a new person named after the file (rename and set
 * parents afterwards on the People page). One genome consent covers the batch; it is recorded per
 * created person, like the single import does. Minors cannot be created here: birth year is unknown.
 */
export function BatchImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { db, refresh } = useApp()
  const ref = useRef<HTMLDialogElement>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [forced, setForced] = useState<Provider | ''>('')
  const [stage, setStage] = useState<'pick' | 'consent' | 'running' | 'done'>('pick')

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const run = async () => {
    setStage('running')
    for (let i = 0; i < rows.length; i++) {
      update(i, { status: 'working', msg: t('batchImportDialog.creatingPerson'), pct: 0 })
      try {
        const person = await addPerson(db, {
          ...personFromFileName(rows[i].file.name),
          sex: 'unknown',
          birthYear: null,
        })
        await grantConsent(db, 'import_genome', person.id)
        const summary = await importGenomeFile(
          db,
          person.id,
          rows[i].file,
          (p) => update(i, { msg: p.msg, pct: p.pct }),
          t,
          forced || undefined,
        )
        update(i, { status: 'done', msg: summary, pct: 100 })
        await refresh()
      } catch (e) {
        update(i, { status: 'error', msg: String(e), pct: 0 })
      }
    }
    setStage('done')
  }

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 className="mt-0">{t('batchImportDialog.title')}</h2>
      {stage === 'pick' && (
        <div>
          <p className="muted">{t('batchImportDialog.intro')}</p>
          <label className="field">
            {t('batchImportDialog.provider')}
            <select value={forced} onChange={(e) => setForced(e.target.value as Provider | '')}>
              <option value="">{t('batchImportDialog.autoDetectPerFile')}</option>
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
              multiple
              accept=".txt,.csv,.vcf,.zip,.gz,.tsv"
              onChange={(e) =>
                setRows(
                  Array.from(e.target.files ?? []).map((file) => ({
                    file,
                    status: 'queued',
                    msg: '',
                    pct: 0,
                  })),
                )
              }
            />
          </p>
          {rows.length > 0 && (
            <ul>
              {rows.map((r) => (
                <li key={r.file.name}>
                  {rich(
                    t('batchImportDialog.fileToPerson', {
                      file: r.file.name,
                      name: personFromFileName(r.file.name).displayName,
                    }),
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={rows.length === 0}
              onClick={() => setStage('consent')}
            >
              {t('batchImportDialog.continue')}
            </button>
            <button type="button" onClick={() => ref.current?.close()}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      {stage === 'consent' && (
        <div>
          <p className="muted">{t('batchImportDialog.consentNote')}</p>
          <ConsentForm kind="import_genome" onCancel={() => setStage('pick')} onConfirm={run} />
        </div>
      )}
      {(stage === 'running' || stage === 'done') && (
        <div>
          <ul>
            {rows.map((r) => (
              <li key={r.file.name}>
                <strong>{personFromFileName(r.file.name).displayName}</strong> ·{' '}
                <span className={r.status === 'error' ? 'danger' : r.status === 'done' ? 'ok' : 'muted'}>
                  {r.status === 'queued' ? t('batchImportDialog.queued') : r.msg}
                </span>
                {r.status === 'working' && <progress value={r.pct} max={100} />}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="primary"
            disabled={stage !== 'done'}
            onClick={() => ref.current?.close()}
          >
            {stage === 'done' ? t('common.close') : t('batchImportDialog.importing')}
          </button>
        </div>
      )}
    </dialog>
  )
}
