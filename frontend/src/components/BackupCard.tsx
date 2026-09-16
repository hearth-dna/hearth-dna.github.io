import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { isArchive } from '../archive/mode'
import { backups, type Status } from '../backup/scheduler'
import { grantConsent, hasConsent, revokeConsent } from '../consent/consent'
import { rich, useT } from '../i18n/context'
import { ConsentForm } from './ConsentForm'

/** Local wall-clock time of an ISO timestamp. */
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function useBackupStatus(): Status {
  const [s, setS] = useState<Status>(backups.status)
  useEffect(() => backups.subscribe(() => setS({ ...backups.status })), [])
  return s
}

/** Settings card for the backup folder (docs/architecture/storage/backup-folder.md). */
export function BackupCard() {
  const { db, refresh } = useApp()
  const t = useT()
  const status = useBackupStatus()
  const [consenting, setConsenting] = useState(false)
  const [pass, setPass] = useState(backups.passphrase())
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const writing = status.state === 'writing'
  const working = writing || busy !== null
  // Only these states can actually write; elsewhere the notice above the buttons says what to do.
  const canBackUp =
    !working && (status.state === 'ready' || status.state === 'conflict' || status.state === 'error')

  // A finished autosave should be visible too, not only one started from the button.
  const [wasWriting, setWasWriting] = useState(false)
  useEffect(() => {
    if (writing) setWasWriting(true)
    else if (wasWriting && status.state === 'ready') {
      setWasWriting(false)
      setMsg(t('backupCard.done', { name: status.name, time: status.lastAt ? clock(status.lastAt) : '' }))
    }
  }, [writing, wasWriting, status, t])

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

  const run = async (f: () => Promise<string | undefined>, label?: string) => {
    setBusy(label ?? null)
    if (label) setMsg(null)
    try {
      setMsg((await f()) ?? null)
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(null)
    }
  }

  const loadFromFolder = async () => {
    const r = await backups.loadFromFolder((key, params) => setBusy(t(key, params)))
    await refresh()
    return t('backupCard.loaded', { ...r, name: backups.name })
  }
  const load = () => run(loadFromFolder, t('backupCard.loading', { name: backups.name }))
  const backUp = (force = false) => {
    setMsg(null)
    return run(() => backups.backupNow(force).then(() => undefined))
  }

  const activity = writing
    ? t(status.step === 'building' ? 'backupCard.building' : 'backupCard.writingFile', { name: status.name })
    : busy

  return (
    <div className="card">
      <h2>{t('backupCard.title')}</h2>
      <p className="muted">{t('backupCard.intro')}</p>
      {status.state === 'unsupported' && <p className="notice">{t('backupCard.unsupported')}</p>}
      {consenting && (
        <ConsentForm
          kind="backup_folder"
          confirmLabel={t('backupCard.chooseFolder')}
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
          {t('backupCard.chooseFolder')}
        </button>
      )}
      {status.state !== 'none' && status.state !== 'unsupported' && (
        <div>
          <p>
            {rich(t('backupCard.folder', { name: status.name }))}
            {status.state === 'ready' && status.lastAt && (
              <span className="muted">{t('backupCard.lastBackup', { time: clock(status.lastAt) })}</span>
            )}
            {status.state === 'ready' && status.pending && (
              <span className="muted">{t('backupCard.pending')}</span>
            )}
          </p>
          {activity && (
            <p className="activity" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" /> {activity}
            </p>
          )}
          <div className="row">
            <label className="field">
              {t(backups.plain ? 'backupCard.passphraseNotUsed' : 'backupCard.passphraseRequired')}
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
              <span>{t('backupCard.storeUnencrypted')}</span>
            </label>
          </div>
          {status.state === 'reconnect' && (
            <p className="notice">
              {t('backupCard.reconnectNotice')}{' '}
              <button
                type="button"
                className="primary"
                onClick={() => run(() => backups.reconnect().then(() => undefined))}
              >
                {t('backupCard.reconnectFolder')}
              </button>
            </p>
          )}
          {status.state === 'needs-passphrase' && <p className="notice">{t('backupCard.needsPassphrase')}</p>}
          {status.state === 'conflict' && (
            <div className="notice">
              {rich(t('backupCard.conflict', { file: status.file }))}
              <div className="row">
                <button type="button" disabled={working} onClick={load}>
                  {t('backupCard.loadTheirs')}
                </button>
                <button type="button" className="danger" disabled={working} onClick={() => backUp(true)}>
                  {t('backupCard.keepMine')}
                </button>
              </div>
            </div>
          )}
          {status.state === 'error' && (
            <p className="danger">{t('backupCard.failed', { message: status.message })}</p>
          )}
          {status.state === 'ready' && status.newer && (
            <p className="notice">
              {t('backupCard.newerNotice')}{' '}
              <button type="button" className="primary" disabled={working} onClick={load}>
                {t('backupCard.loadFromFolder')}
              </button>
            </p>
          )}
          <div className="row">
            <button type="button" className="primary" disabled={!canBackUp} onClick={() => backUp()}>
              {t('backupCard.backUpNow')}
            </button>
            {status.state === 'ready' && !status.newer && (
              <button type="button" disabled={working} onClick={load}>
                {t('backupCard.loadFromFolder')}
              </button>
            )}
            <button type="button" disabled={working} onClick={choose}>
              {t('backupCard.changeFolder')}
            </button>
            <button
              type="button"
              className="danger"
              disabled={working}
              onClick={() =>
                run(async () => {
                  const del = confirm(t('backupCard.forgetConfirm'))
                  const n = await backups.forget(del)
                  await revokeConsent(db, 'backup_folder')
                  return del ? t('backupCard.forgottenDeleted', { n }) : t('backupCard.forgottenKept')
                })
              }
            >
              {t('backupCard.forgetFolder')}
            </button>
          </div>
        </div>
      )}
      {msg && <p>{msg}</p>}
    </div>
  )
}
