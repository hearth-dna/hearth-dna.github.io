import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { isArchive } from '../archive/mode'
import { backups, type Status } from '../backup/scheduler'
import { canShareFiles } from '../backup/share'
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
  // The consent form stands in front of the first folder pick.
  const [consenting, setConsenting] = useState(false)
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
  if (status.state === 'manual') return <ManualBackup status={status} />

  const choose = async () => {
    if (!(await hasConsent(db, 'backup_folder'))) return setConsenting(true)
    try {
      await backups.choose()
      setMsg(null)
    } catch (e) {
      setMsg(String(e))
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
    const { people, genomes, exportedAt } = r
    return t('backupCard.loaded', { people, genomes, exportedAt, name: backups.name })
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
      <p className="muted">{t('backupCard.intro')}</p>
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
        <div className="row">
          <button type="button" className="primary" disabled={working} onClick={choose}>
            {t('backupCard.chooseFolder')}
          </button>
        </div>
      )}
      {status.state !== 'none' && (
        <div>
          <p>
            {rich(t('backupCard.folder', { name: status.name }))}
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
          {status.state === 'ready' && status.attachmentsMissing > 0 && (
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
          {status.state === 'ready' && status.missing.length > 0 && (
            <p className="notice">
              {t('backupCard.missingGenomes', {
                name: status.name,
                names: status.missing.map((m) => m.name).join(', '),
              })}
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
      {msg && <p>{msg}</p>}
    </div>
  )
}

/**
 * The same card for browsers without a folder picker (phones, Safari, Firefox): a snapshot goes to
 * the share sheet (Google Drive, Files…) or is downloaded, and a saved one is loaded from a file.
 */
function ManualBackup({ status }: { status: Extract<Status, { state: 'manual' }> }) {
  const { refresh } = useApp()
  const t = useT()
  const [pass, setPass] = useState(backups.passphrase())
  const [msg, setMsg] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const share = canShareFiles()
  const needsPass = !backups.plain && !pass
  const working = status.step !== null

  const backUp = async () => {
    setMsg(null)
    try {
      const how = await backups.shareNow()
      if (how === 'shared' || how === 'downloaded')
        setMsg(t(how === 'shared' ? 'backupCard.shared' : 'backupCard.downloaded'))
    } catch (e) {
      setMsg(t('backupCard.failed', { message: e instanceof Error ? e.message : String(e) }))
    }
  }

  const load = async (file: File) => {
    setMsg(null)
    try {
      const r = await backups.loadFile(file, (key, params) => setProgress(t(key, params)))
      await refresh()
      const { people, genomes, exportedAt } = r
      setMsg(t('backupCard.loaded', { people, genomes, exportedAt, name: file.name }))
    } catch (e) {
      setMsg(t('backupCard.loadFailed', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setProgress(null)
    }
  }

  const loadGenomes = async (files: File[]) => {
    setMsg(null)
    try {
      const r = await backups.loadGenomeFiles(files, (key, params) => setProgress(t(key, params)))
      await refresh()
      setMsg(
        [
          t('backupCard.genomesLoaded', { n: r.loaded }),
          r.unmatched ? t('backupCard.genomesUnmatched', { n: r.unmatched }) : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
    } catch (e) {
      setMsg(t('backupCard.loadFailed', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setProgress(null)
    }
  }

  const activity =
    status.step === 'building'
      ? t('backupCard.building')
      : status.step === 'loading'
        ? (progress ?? t('settingsPage.readingDump'))
        : null

  return (
    <div className="card">
      <h2>{t('backupCard.titleManual')}</h2>
      <p className="muted">{rich(t('backupCard.introManual'))}</p>
      {!share && <p className="notice">{t('backupCard.downloadOnly')}</p>}
      <p>
        {status.lastAt
          ? t('backupCard.lastShared', { time: new Date(status.lastAt).toLocaleString() })
          : t('backupCard.neverShared')}
        {status.dirty && status.lastAt && <span className="muted">{t('backupCard.changedSince')}</span>}
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
      {needsPass && <p className="notice">{t('backupCard.needsPassphraseManual')}</p>}
      {status.missing.length > 0 && (
        <p className="notice">
          {t('restore.missingGenomes', { names: status.missing.map((m) => m.name).join(', ') })}
        </p>
      )}
      {status.elsewhere.length > 0 && (
        <div className="notice">
          <p className="mt-0">
            {t('restore.genomesElsewhere', { names: status.elsewhere.map((m) => m.name).join(', ') })}{' '}
            {t('backupCard.pickGenomes')}
          </p>
          <label className="btn">
            {t('backupCard.loadGenomes')}
            {/* No `accept`, as for the backup itself; the files are matched by content. */}
            <input
              type="file"
              multiple
              hidden
              disabled={working}
              onChange={(e) => {
                const fs = [...(e.target.files ?? [])]
                e.target.value = ''
                if (fs.length) void loadGenomes(fs)
              }}
            />
          </label>
        </div>
      )}
      {status.file && <p className="notice">{t('backupCard.fileReady', { name: status.file })}</p>}
      <div className="row">
        <button type="button" className="primary" disabled={working || needsPass} onClick={backUp}>
          {t(
            status.file
              ? 'backupCard.shareFile'
              : share
                ? 'backupCard.backUpShare'
                : 'backupCard.backUpDownload',
          )}
        </button>
        <label className="btn">
          {t('backupCard.loadFile')}
          {/* No `accept`: iOS greys out files whose extension it does not know, like .hearth. */}
          <input
            type="file"
            hidden
            disabled={working}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void load(f)
            }}
          />
        </label>
      </div>
      {msg && <p>{msg}</p>}
    </div>
  )
}
