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
  const files = useFileLoader()
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
    : (busy ?? files.progress)

  return (
    <div className="card">
      <h2>{t('backupCard.title')}</h2>
      <p className="muted">{t('backupCard.intro')}</p>
      <ElsewhereNotice disabled={working} onFiles={files.load} />
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
            {status.state === 'ready' && (
              <button
                type="button"
                disabled={working}
                title={t('backupCard.phoneCopyHint')}
                onClick={() =>
                  run(
                    async () =>
                      t('backupCard.phoneCopyDone', {
                        file: await backups.writePhoneCopy(),
                        name: backups.name,
                      }),
                    t('backupCard.building'),
                  )
                }
              >
                {t('backupCard.phoneCopy')}
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
      {files.msg && <p>{files.msg}</p>}
    </div>
  )
}

/**
 * The same card for browsers without a folder picker (phones, Safari, Firefox): a snapshot goes to
 * the share sheet (Google Drive, Files…) or is downloaded, and a saved one is loaded from a file.
 */
function ManualBackup({ status }: { status: Extract<Status, { state: 'manual' }> }) {
  const t = useT()
  const [pass, setPass] = useState(backups.passphrase())
  const { msg, setMsg, progress, load } = useFileLoader()
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
      <ElsewhereNotice disabled={working} onFiles={load} />
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
        <PickFiles label={t('backupCard.loadFile')} disabled={working} onFiles={load} />
      </div>
      <p className="muted">{t('backupCard.oneFileHint')}</p>
      {msg && <p>{msg}</p>}
    </div>
  )
}

/**
 * Opens the file picker for several files at once. No `accept`: phones grey out files whose type
 * they do not know, like .hearth and the genome files, and the loader tells them apart by content.
 */
export function PickFiles({
  label,
  disabled,
  onFiles,
}: {
  label: string
  disabled?: boolean
  onFiles: (files: File[]) => void
}) {
  return (
    <label className="btn">
      {label}
      <input
        type="file"
        multiple
        hidden
        disabled={disabled}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </label>
  )
}

/** Loads picked files (backups, genome files, or both at once) and words what came in. */
export function useFileLoader(passphrase?: () => string) {
  const { refresh } = useApp()
  const t = useT()
  const [msg, setMsg] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const load = async (files: File[]) => {
    setMsg(null)
    try {
      const r = await backups.loadFiles(files, (key, params) => setProgress(t(key, params)), passphrase?.())
      await refresh()
      const { people, genomes, exportedAt, name } = r
      setMsg(
        [
          r.dumps
            ? t('backupCard.loaded', { people, genomes, exportedAt, name })
            : t('backupCard.genomesLoaded', { n: genomes }),
          ...r.dna.map((d) => t('backupCard.dnaFrom', { name: d.name, file: d.file })),
          r.unused.length ? t('backupCard.notUsed', { files: r.unused.join(', ') }) : '',
          r.unopened.length ? t('backupCard.notOpened', { files: r.unopened.join(', ') }) : '',
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
  return { msg, setMsg, progress, load }
}

/** People whose genome files a loaded folder snapshot keeps beside itself, and the way to add them. */
function ElsewhereNotice({ disabled, onFiles }: { disabled: boolean; onFiles: (files: File[]) => void }) {
  const t = useT()
  const names = backups.elsewhereNames
  if (!names.length) return null
  return (
    <div className="notice">
      <p className="mt-0">
        {t('restore.genomesElsewhere', { names: names.map((m) => m.name).join(', ') })}{' '}
        {t('backupCard.pickGenomes')}
      </p>
      <PickFiles label={t('backupCard.loadGenomes')} disabled={disabled} onFiles={onFiles} />
    </div>
  )
}
