import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { isArchive } from '../archive/mode'
import { backups, type Status } from '../backup/scheduler'
import { grantConsent, hasConsent, revokeConsent } from '../consent/consent'
import { ConsentForm } from './ConsentForm'

function useBackupStatus(): Status {
  const [s, setS] = useState<Status>(backups.status)
  useEffect(() => backups.subscribe(() => setS({ ...backups.status })), [])
  return s
}

/** Settings card for the backup folder (docs/architecture/storage/backup-folder.md). */
export function BackupCard() {
  const { db, refresh } = useApp()
  const status = useBackupStatus()
  const [consenting, setConsenting] = useState(false)
  const [pass, setPass] = useState(backups.passphrase())
  const [msg, setMsg] = useState<string | null>(null)

  if (isArchive()) return null

  const choose = async () => {
    if (!(await hasConsent(db, 'backup_folder'))) return setConsenting(true)
    try {
      await backups.choose()
      setMsg(null)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setMsg(String(e))
    }
  }

  const run = async (f: () => Promise<string | undefined>) => {
    try {
      setMsg((await f()) ?? null)
    } catch (e) {
      setMsg(String(e))
    }
  }

  return (
    <div className="card">
      <h2>Backup folder</h2>
      <p className="muted">
        Hearth writes a snapshot of everything to a folder you choose — on a USB stick, or a folder that
        Google Drive, Dropbox, OneDrive or similar keeps in sync — after every change, and can load it back on
        another computer. Nothing is sent by Hearth itself.
      </p>
      {status.state === 'unsupported' && (
        <p className="notice">
          Your browser cannot write to a folder on its own (Chrome, Edge and other Chromium browsers can). Use
          Export dump and Import dump above instead.
        </p>
      )}
      {consenting && (
        <ConsentForm
          kind="backup_folder"
          confirmLabel="Choose folder…"
          onCancel={() => setConsenting(false)}
          onConfirm={async () => {
            await grantConsent(db, 'backup_folder')
            setConsenting(false)
            await choose()
          }}
        />
      )}
      {status.state === 'none' && !consenting && (
        <button type="button" className="primary" onClick={choose}>
          Choose folder…
        </button>
      )}
      {status.state !== 'none' && status.state !== 'unsupported' && (
        <div>
          <p>
            Folder: <strong>{status.name}</strong>
            {status.state === 'ready' && status.lastAt && (
              <span className="muted"> · last backup {status.lastAt.slice(11, 19)}</span>
            )}
            {status.state === 'ready' && status.pending && <span className="muted"> · backup pending…</span>}
            {status.state === 'writing' && <span className="muted"> · writing…</span>}
          </p>
          <div className="row">
            <label className="field">
              Passphrase {backups.plain ? '(not used)' : '(required)'}
              <input
                type="password"
                value={pass}
                disabled={backups.plain}
                onChange={(e) => {
                  setPass(e.target.value)
                  backups.setPassphrase(e.target.value)
                }}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={backups.plain}
                onChange={(e) => void backups.setPlain(e.target.checked)}
              />
              <span>Store unencrypted (plaintext genetic data in the folder)</span>
            </label>
          </div>
          {status.state === 'reconnect' && (
            <p className="notice">
              The browser needs your permission again to use this folder.{' '}
              <button
                type="button"
                className="primary"
                onClick={() => run(() => backups.reconnect().then(() => undefined))}
              >
                Reconnect folder
              </button>
            </p>
          )}
          {status.state === 'needs-passphrase' && (
            <p className="notice">Enter the passphrase (or tick unencrypted) to resume backups.</p>
          )}
          {status.state === 'conflict' && (
            <div className="notice">
              Another computer saved a newer backup to this folder since you last loaded it. Yours was written
              as <code>{status.file}</code> instead. Load theirs first, or keep yours and overwrite.
              <div className="row">
                <button
                  type="button"
                  onClick={() =>
                    run(() =>
                      backups
                        .loadFromFolder(setMsg)
                        .then(refresh)
                        .then(() => undefined),
                    )
                  }
                >
                  Load theirs
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => run(() => backups.backupNow(true).then(() => undefined))}
                >
                  Keep mine, overwrite
                </button>
              </div>
            </div>
          )}
          {status.state === 'error' && <p className="danger">Backup failed: {status.message}</p>}
          {status.state === 'ready' && status.newer && (
            <p className="notice">
              The folder holds a backup from another computer that is newer than what is here.{' '}
              <button
                type="button"
                className="primary"
                onClick={() =>
                  run(async () => {
                    const m = await backups.loadFromFolder(setMsg)
                    await refresh()
                    return m
                  })
                }
              >
                Load from folder
              </button>
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={status.state === 'writing'}
              onClick={() => run(() => backups.backupNow().then(() => undefined))}
            >
              Back up now
            </button>
            {status.state === 'ready' && !status.newer && (
              <button
                type="button"
                onClick={() =>
                  run(async () => {
                    const m = await backups.loadFromFolder(setMsg)
                    await refresh()
                    return m
                  })
                }
              >
                Load from folder
              </button>
            )}
            <button type="button" onClick={choose}>
              Change folder…
            </button>
            <button
              type="button"
              className="danger"
              onClick={() =>
                run(async () => {
                  const del = confirm('Also delete the backup files in the folder? (Cancel keeps them.)')
                  const n = await backups.forget(del)
                  await revokeConsent(db, 'backup_folder')
                  return del
                    ? `Folder forgotten; ${n} backup files deleted.`
                    : 'Folder forgotten; files kept.'
                })
              }
            >
              Forget folder
            </button>
          </div>
        </div>
      )}
      {msg && <p>{msg}</p>}
    </div>
  )
}
