import { useEffect, useState } from 'react'
import { backups, type Status } from '../backup/scheduler'
import { useT } from '../i18n/context'

/** Local wall-clock time of an ISO timestamp. */
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The time today, the date otherwise: a shared backup can be days old. */
const when = (iso: string) =>
  new Date(iso).toDateString() === new Date().toDateString()
    ? clock(iso)
    : new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })

type Look = {
  icon: string
  label: string
  title: string
  tone: '' | 'ok' | 'warn' | 'danger'
  busy?: boolean
}

/**
 * Header button for the backup folder (docs/architecture/storage/backup-folder.md). Shows at a
 * glance whether this browser and the folder agree, and syncs on click: loads a newer snapshot
 * from another computer first, then writes this browser's state. States that need the user
 * (no folder yet, a passphrase) open Settings instead.
 */
export function SyncButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useT()
  const [status, setStatus] = useState<Status>(backups.status)
  const [progress, setProgress] = useState<string | null>(null)
  useEffect(() => backups.subscribe(() => setStatus({ ...backups.status })), [])

  const needsPass = !backups.plain && !backups.passphrase()

  const look = ((): Look => {
    switch (status.state) {
      case 'manual':
        if (status.step)
          return { icon: '', label: t('sync.backingUp'), title: t('sync.backingUp'), tone: '', busy: true }
        if (needsPass)
          return { icon: '!', label: t('sync.passphrase'), title: t('sync.passphraseHint'), tone: 'warn' }
        if (status.file) return { icon: '↑', label: t('sync.shareReady'), title: status.file, tone: 'warn' }
        if (status.dirty || !status.lastAt)
          return { icon: '●', label: t('sync.backUp'), title: t('sync.backUpHint'), tone: 'warn' }
        return {
          icon: '✓',
          label: t('sync.backedUpAt', { time: when(status.lastAt) }),
          title: t('sync.backedUpHint'),
          tone: 'ok',
        }
      case 'none':
        return { icon: '⇅', label: t('sync.setUp'), title: t('sync.setUpHint'), tone: '' }
      case 'reconnect':
        return {
          icon: '!',
          label: t('sync.reconnect'),
          title: t('sync.reconnectHint', { name: status.name }),
          tone: 'warn',
        }
      case 'needs-passphrase':
        return { icon: '!', label: t('sync.passphrase'), title: t('sync.passphraseHint'), tone: 'warn' }
      case 'writing':
        return {
          icon: '',
          label: progress ?? t('sync.syncing'),
          title: t('sync.syncingHint', { name: status.name }),
          tone: '',
          busy: true,
        }
      case 'error':
        return { icon: '!', label: t('sync.error'), title: status.message, tone: 'danger' }
      case 'ready':
        if (status.dirty)
          return {
            icon: '●',
            label: status.pending ? t('sync.pending') : t('sync.unsynced'),
            title: status.pending ? t('sync.pendingHint') : t('sync.unsyncedHint', { name: status.name }),
            tone: 'warn',
          }
        return {
          icon: '✓',
          label: status.lastAt ? t('sync.syncedAt', { time: clock(status.lastAt) }) : t('sync.synced'),
          title: t('sync.syncedHint', { name: status.name }),
          tone: 'ok',
        }
    }
  })()

  const click = async () => {
    if (status.state === 'manual') {
      if (needsPass) return onOpenSettings()
      // On a failure the Settings card is where backing up can be retried and the reason shown.
      return void backups.shareNow().catch(onOpenSettings)
    }
    if (status.state === 'reconnect') return void backups.reconnect()
    if (status.state === 'ready' || status.state === 'error') {
      if (status.state === 'error') await backups.refresh()
      setProgress(null)
      await backups.sync((key, params) => setProgress(t(key, params)))
      setProgress(null)
      return
    }
    onOpenSettings()
  }

  return (
    <button
      type="button"
      className={`sync small ${look.tone}`}
      title={look.title}
      aria-live="polite"
      disabled={look.busy}
      onClick={click}
    >
      {look.busy ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{look.icon}</span>
      )}
      <span className="sync-label">{look.label}</span>
    </button>
  )
}
