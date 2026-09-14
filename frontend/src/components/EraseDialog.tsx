import { useEffect, useRef, useState } from 'react'
import { APP_VERSION, useApp } from '../app/context'
import { revokeConsent } from '../consent/consent'
import { eraseEverything } from '../db/repo'
import { exportDumpFile } from '../export/exportDump'

/** Erase-everything confirmation that offers a dump export first; erasing reloads to the gate. */
export function EraseDialog({ onClose }: { onClose: () => void }) {
  const { db, persons } = useApp()
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
      setMsg(await exportDumpFile(db, APP_VERSION, pass))
    } catch (e) {
      setMsg(`Export failed: ${e}`)
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
      setMsg(`Erase failed: ${e}`)
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>Erase all data on this device?</h2>
      <p>
        This deletes all people, genotypes, consents, notes and logs from this browser. Hearth keeps no copy
        anywhere, so there is nothing to recover afterwards.
      </p>
      <div className="notice">
        <strong>Export first.</strong> Save a dump to your files now; you can import it later from Settings
        &amp; export to get everything back, on this device or another.
      </div>
      <div className="row">
        <label className="field">
          Passphrase (optional, encrypts the dump)
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} disabled={busy} />
        </label>
        <button
          type="button"
          className="primary"
          onClick={exportFirst}
          disabled={busy || persons.length === 0}
        >
          Export dump
        </button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      <div className="row" style={{ marginTop: '1rem' }}>
        <button type="button" className="danger" onClick={erase} disabled={busy}>
          Erase everything
        </button>
        <button type="button" onClick={() => ref.current?.close()} disabled={busy}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}
