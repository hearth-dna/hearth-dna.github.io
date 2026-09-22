import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { isArchive } from '../archive/mode'
import { type ChooseDriveFolder, type DriveBrowser, pickModes } from '../backup/folder'
import type { PickMode } from '../backup/native'
import { backups, type Status } from '../backup/scheduler'
import { grantConsent, hasConsent, revokeConsent } from '../consent/consent'
import { rich, useT } from '../i18n/context'
import { ConsentForm } from './ConsentForm'
import { DriveFolderChooser } from './DriveFolderChooser'

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
  // The pick the consent form is standing in front of; null when it is not showing.
  const [consenting, setConsenting] = useState<PickMode | null>(null)
  // The phone apps can pick a file as well as a folder, so changing the place is a choice too.
  const [changing, setChanging] = useState(false)
  const [modes, setModes] = useState<PickMode[]>([])
  // The Drive folder chooser, while a Google sign-in waits for the user to pick a folder.
  const [driveBrowse, setDriveBrowse] = useState<{
    browser: DriveBrowser
    done: (folder: Awaited<ReturnType<ChooseDriveFolder>>) => void
  } | null>(null)
  const chooseDriveFolder: ChooseDriveFolder = (browser) =>
    new Promise((resolve) =>
      setDriveBrowse({
        browser,
        done: (folder) => {
          setDriveBrowse(null)
          resolve(folder)
        },
      }),
    )
  useEffect(() => {
    void pickModes().then(setModes)
  }, [])
  const clouds: PickMode[] = modes.filter((m) => m === 'google' || m === 'dropbox' || m === 'icloud')
  const places = modes.filter((m) => !clouds.includes(m))
  // The phone apps: more than the browser's single folder button.
  const phone = modes.length > 1
  const [pass, setPass] = useState(backups.passphrase())
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const writing = status.state === 'writing'
  const working = writing || busy !== null
  // Only these states can actually write; elsewhere the notice above the buttons says what to do.
  const canBackUp = !working && (status.state === 'ready' || status.state === 'error')

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

  const consentFor = (mode: PickMode) => (clouds.includes(mode) ? 'cloud_backup' : 'backup_folder')

  const choose = async (mode: PickMode) => {
    if (!(await hasConsent(db, consentFor(mode)))) return setConsenting(mode)
    try {
      await backups.choose(mode, chooseDriveFolder)
      setChanging(false)
      setMsg(null)
    } catch (e) {
      setMsg(String(e))
    }
  }

  const pickLabel: Record<PickMode, string> = {
    folder: t('backupCard.chooseFolder'),
    newFile: t('backupCard.newFile'),
    existingFile: t('backupCard.existingFile'),
    google: t('backupCard.google'),
    dropbox: t('backupCard.dropbox'),
    icloud: t('backupCard.icloud'),
  }
  const button = (mode: PickMode, primary: boolean) => (
    <button
      key={mode}
      type="button"
      className={primary ? 'primary' : undefined}
      disabled={working}
      onClick={() => choose(mode)}
    >
      {pickLabel[mode]}
    </button>
  )
  const pickButtons = (
    <>
      {clouds.length > 0 && (
        <>
          <p className="muted">{t('backupCard.cloudHint')}</p>
          <div className="row">{clouds.map((mode, i) => button(mode, i === 0))}</div>
        </>
      )}
      {places.length > 1 && (
        <p className="muted">
          {clouds.length > 0
            ? t('backupCard.otherPlacesHint')
            : rich(
                t(
                  places.indexOf('newFile') < places.indexOf('folder')
                    ? 'backupCard.pickHintAndroid'
                    : 'backupCard.pickHint',
                ),
              )}
        </p>
      )}
      <div className="row">
        {places.map((mode, i) => button(mode, clouds.length === 0 && i === 0))}
        {changing && (
          <button type="button" onClick={() => setChanging(false)}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    </>
  )

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
  const backUp = () => {
    setMsg(null)
    return run(() => backups.backupNow().then(() => undefined))
  }

  const activity = writing
    ? t(
        status.step === 'loading'
          ? 'backupCard.loading'
          : status.step === 'building'
            ? 'backupCard.building'
            : status.step === 'attachments'
              ? 'backupCard.copyingAttachments'
              : 'backupCard.writingFile',
        { name: status.name },
      )
    : busy

  return (
    <div className="card">
      <h2>{t('backupCard.title')}</h2>
      <p className="muted">
        {t(
          clouds.length > 0 ? 'backupCard.introCloud' : phone ? 'backupCard.introPhone' : 'backupCard.intro',
        )}
      </p>
      {status.state === 'unsupported' && <p className="notice">{t('backupCard.unsupported')}</p>}
      {consenting && (
        <ConsentForm
          kind={consentFor(consenting)}
          confirmLabel={pickLabel[consenting]}
          onCancel={() => setConsenting(null)}
          onConfirm={async () => {
            await grantConsent(db, consentFor(consenting))
            setConsenting(null)
            await choose(consenting)
          }}
        />
      )}
      {status.state === 'none' && !consenting && !driveBrowse && pickButtons}
      {status.state !== 'none' && status.state !== 'unsupported' && (
        <div>
          <p>
            {rich(t(backups.single ? 'backupCard.file' : 'backupCard.folder', { name: status.name }))}
            {status.state === 'ready' && status.lastAt && (
              <span className="muted">{t('backupCard.lastBackup', { time: clock(status.lastAt) })}</span>
            )}
            {status.state === 'ready' && status.pending && (
              <span className="muted">{t('backupCard.pending')}</span>
            )}
            {status.state === 'ready' && status.attachmentsPending > 0 && (
              <span className="muted">
                {t('backupCard.attachmentsPending', { n: status.attachmentsPending })}
              </span>
            )}
          </p>
          {backups.single && <p className="muted">{t('backupCard.singleNote')}</p>}
          {backups.cloud && <p className="muted">{t('backupCard.cloudNote')}</p>}
          {status.state === 'ready' && status.attachmentsMissing > 0 && !backups.single && (
            <p className="notice">
              {t('backupCard.attachmentsMissing', { n: status.attachmentsMissing })}{' '}
              <button
                type="button"
                disabled={working}
                onClick={() =>
                  run(async () => {
                    const r = await backups.pullNow()
                    return t('backupCard.attachmentsFetched', { n: r.pulled, missing: r.missing })
                  })
                }
              >
                {t('backupCard.fetchAttachments')}
              </button>
            </p>
          )}
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
                onChange={(e) => setPass(e.target.value)}
                // Applied when typing is done, never per keystroke: each change re-reads the folder
                // and could encrypt a backup with half a passphrase.
                onBlur={() => pass !== backups.passphrase() && backups.setPassphrase(pass)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              {phone && !backups.plain && (
                <span className="muted small">{t('backupCard.passphraseKept')}</span>
              )}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={backups.auto}
                onChange={(e) => void backups.setAuto(e.target.checked)}
              />
              <span>{t('backupCard.autoSync')}</span>
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
              {phone
                ? t('backupCard.reconnectNoticeNative', { name: status.name })
                : t('backupCard.reconnectNotice')}{' '}
              <button
                type="button"
                className="primary"
                onClick={() => run(() => backups.reconnect(chooseDriveFolder).then(() => undefined))}
              >
                {t(phone ? 'backupCard.pickAgain' : 'backupCard.reconnectFolder')}
              </button>
            </p>
          )}
          {status.state === 'needs-passphrase' && <p className="notice">{t('backupCard.needsPassphrase')}</p>}
          {status.state === 'error' && (
            <p className="danger">{t('backupCard.failed', { message: status.message })}</p>
          )}
          <div className="row">
            <button type="button" className="primary" disabled={!canBackUp} onClick={() => backUp()}>
              {t('backupCard.backUpNow')}
            </button>
            {status.state === 'ready' && (
              <button type="button" disabled={working} onClick={load}>
                {t('backupCard.loadFromFolder')}
              </button>
            )}
            <button
              type="button"
              disabled={working}
              onClick={() => (phone ? setChanging(true) : choose('folder'))}
            >
              {t('backupCard.changeFolder')}
            </button>
            <button
              type="button"
              className="danger"
              disabled={working}
              onClick={() =>
                run(async () => {
                  const del = confirm(t('backupCard.forgetConfirm'))
                  const { snapshots, attachments } = await backups.forget(del)
                  await revokeConsent(db, 'backup_folder')
                  return del
                    ? t('backupCard.forgottenDeletedWithFiles', { n: snapshots, files: attachments })
                    : t('backupCard.forgottenKept')
                })
              }
            >
              {t('backupCard.forgetFolder')}
            </button>
          </div>
        </div>
      )}
      {driveBrowse && <DriveFolderChooser browser={driveBrowse.browser} onDone={driveBrowse.done} />}
      {changing && status.state !== 'none' && !consenting && !driveBrowse && pickButtons}
      {msg && <p>{msg}</p>}
    </div>
  )
}
