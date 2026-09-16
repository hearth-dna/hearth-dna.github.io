import { useEffect, useRef, useState } from 'react'
import { APP_VERSION, useApp } from '../app/context'
import { revokeConsent } from '../consent/consent'
import { eraseEverything } from '../db/repo'
import { exportDumpFile } from '../export/exportDump'
import { rich, useT } from '../i18n/context'

/** Erase-everything confirmation that offers a dump export first; erasing reloads to the gate. */
export function EraseDialog({ onClose }: { onClose: () => void }) {
  const { db, persons } = useApp()
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const exportFirst = async () => {
    setBusy(true)
    try {
      const r = await exportDumpFile(db, APP_VERSION, pass)
      setMsg(t(r.encrypted ? 'exportDump.encrypted' : 'exportDump.plaintext', { name: r.name, mb: r.mb }))
    } catch (e) {
      setMsg(t('eraseDialog.exportFailed', { error: String(e) }))
    } finally {
      setBusy(false)
    }
  }
  const erase = async () => {
    setBusy(true)
    try {
      await eraseEverything(db)
      // Also drops the first-launch mirror, so the next load asks again.
      await revokeConsent(db, 'first_launch')
      location.reload()
    } catch (e) {
      setMsg(t('eraseDialog.eraseFailed', { error: String(e) }))
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>{t('eraseDialog.title')}</h2>
      <p>{t('eraseDialog.intro')}</p>
      <div className="notice">{rich(t('eraseDialog.exportFirst'))}</div>
      <div className="row">
        <label className="field">
          {t('eraseDialog.passphrase')}
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} disabled={busy} />
        </label>
        <button
          type="button"
          className="primary"
          onClick={exportFirst}
          disabled={busy || persons.length === 0}
        >
          {t('eraseDialog.exportDump')}
        </button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      <div className="row" style={{ marginTop: '1rem' }}>
        <button type="button" className="danger" onClick={erase} disabled={busy}>
          {t('eraseDialog.eraseEverything')}
        </button>
        <button type="button" onClick={() => ref.current?.close()} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </dialog>
  )
}
