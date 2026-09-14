import { useState } from 'react'
import { APP_VERSION, useApp } from '../app/context'
import { downloadArchive, isArchive, saveArchive } from '../archive/mode'

/** Settings card for the single-file portable archive (docs/architecture/storage/portable-archive.md). */
export function ArchiveCard() {
  const { db, persons } = useApp()
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const archive = isArchive()

  const go = async () => {
    setMsg('Building archive…')
    try {
      setMsg(await (archive ? saveArchive : downloadArchive)(db, APP_VERSION, pass || undefined))
    } catch (e) {
      setMsg(`Failed: ${e}`)
    }
  }

  return (
    <div className="card">
      <h2>Portable archive</h2>
      <p className="muted">
        {archive
          ? 'This page is a portable archive running in memory. Changes you make here are kept only if you save a new archive file.'
          : 'One .html file that contains Hearth itself and all your data. Double-click it in any desktop browser — on a USB stick, on another computer, years from now — and browse everything without installing anything. Import it here to bring the data back.'}
      </p>
      <div className="row">
        <label className="field">
          Passphrase (recommended)
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
        <button type="button" className="primary" onClick={go} disabled={persons.length === 0}>
          {archive ? 'Save archive…' : 'Download portable archive'}
        </button>
      </div>
      {!pass && (
        <p className="muted">
          Without a passphrase the file contains plaintext genetic data and is named accordingly.
        </p>
      )}
      {msg && <p>{msg}</p>}
    </div>
  )
}
