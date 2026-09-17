import { useState } from 'react'
import { useApp } from '../app/context'
import { type Exported, exportFindings, exportGenotypes, exportHealthLog } from '../export/openFormats'
import type { OpenFormat } from '../export/table'
import { useT } from '../i18n/context'

/** Settings card: CSV for spreadsheets, JSON Lines for scripts (docs/architecture/storage/open-formats.md). */
export function OpenFormatsCard() {
  const { db, kb, persons } = useApp()
  const t = useT()
  const [format, setFormat] = useState<OpenFormat>('csv')
  const [shared, setShared] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const run = async (label: string, f: () => Promise<Exported>) => {
    setBusy(label)
    setMsg(null)
    try {
      const r = await f()
      setMsg(
        t('openFormats.done', {
          name: r.name,
          rows: r.rows.toLocaleString(),
          mb: (r.bytes / 1024 / 1024).toFixed(1),
        }),
      )
    } catch (e) {
      setMsg(t('openFormats.failed', { error: String(e) }))
    } finally {
      setBusy(null)
    }
  }

  const none = persons.length === 0
  return (
    <div className="card">
      <h2>{t('openFormats.title')}</h2>
      <p className="muted">{t('openFormats.intro')}</p>
      <div className="row">
        <label className="field">
          {t('openFormats.format')}
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as OpenFormat)}
            disabled={busy !== null}
          >
            <option value="csv">{t('openFormats.csv')}</option>
            <option value="jsonl">{t('openFormats.jsonl')}</option>
          </select>
        </label>
        <button
          type="button"
          className="primary"
          disabled={none || busy !== null}
          onClick={() => run(t('openFormats.genotypes'), () => exportGenotypes(db, persons, format, shared))}
        >
          {t('openFormats.genotypes')}
        </button>
        <button
          type="button"
          disabled={none || busy !== null}
          onClick={() => run(t('openFormats.findings'), () => exportFindings(db, kb, persons, format))}
        >
          {t('openFormats.findings')}
        </button>
        <button
          type="button"
          disabled={none || busy !== null}
          onClick={() => run(t('openFormats.healthLog'), () => exportHealthLog(db, persons, format))}
        >
          {t('openFormats.healthLog')}
        </button>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={shared}
          onChange={(e) => setShared(e.target.checked)}
          disabled={busy !== null}
        />
        <span>{t('openFormats.sharedOnly')}</span>
      </label>
      <p className="muted">{t('openFormats.plaintextWarning')}</p>
      {busy && (
        <p className="activity" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> {t('openFormats.building', { what: busy })}
        </p>
      )}
      {msg && <p>{msg}</p>}
    </div>
  )
}
