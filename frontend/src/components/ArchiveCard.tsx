import { useState } from 'react'
import { APP_VERSION, useApp } from '../app/context'
import { downloadArchive, isArchive, saveArchive } from '../archive/mode'
import { useT } from '../i18n/context'

/** Settings card for the single-file portable archive (docs/architecture/storage/portable-archive.md). */
export function ArchiveCard() {
  const { db, persons } = useApp()
  const t = useT()
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const archive = isArchive()

  const go = async () => {
    setMsg(t('archiveCard.building'))
    try {
      const file = await (archive ? saveArchive : downloadArchive)(db, APP_VERSION, pass || undefined)
      setMsg(t(archive ? 'archiveCard.saved' : 'archiveCard.downloaded', { ...file }))
    } catch (e) {
      setMsg(t('archiveCard.failed', { error: String(e) }))
    }
  }

  return (
    <div className="card">
      <h2>{t('archiveCard.title')}</h2>
      <p className="muted">{t(archive ? 'archiveCard.introArchive' : 'archiveCard.introHosted')}</p>
      <div className="row">
        <label className="field">
          {t('archiveCard.passphrase')}
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
        <button type="button" className="primary" onClick={go} disabled={persons.length === 0}>
          {t(archive ? 'archiveCard.saveArchive' : 'archiveCard.downloadArchive')}
        </button>
      </div>
      {!pass && <p className="muted">{t('archiveCard.plaintextWarning')}</p>}
      {msg && <p>{msg}</p>}
    </div>
  )
}
