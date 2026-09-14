import { useEffect, useState } from 'react'
import { APP_VERSION, AppContext, type AppState } from './app/context'
import { archivePayload, openArchiveDb } from './archive/mode'
import { backups } from './backup/scheduler'
import { AskPage } from './components/AskPage'
import { ConsentGate } from './components/ConsentGate'
import { EraseDialog } from './components/EraseDialog'
import { FamilyPage } from './components/FamilyPage'
import { PeoplePage } from './components/PeoplePage'
import { PersonPage } from './components/PersonPage'
import { SettingsPage } from './components/SettingsPage'
import { hasConsent } from './consent/consent'
import { Database } from './db/db'
import { genotypeCounts, listPersons, listRelationships } from './db/repo'
import { readHeader } from './export/container'
import { restoreBytes } from './export/restore'
import { type Kb, loadKb } from './kb/kb'

type Page =
  | { name: 'people' }
  | { name: 'person'; id: string }
  | { name: 'family' }
  | { name: 'ask' }
  | { name: 'settings' }

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [takenOver, setTakenOver] = useState(false)
  const [memoryOk, setMemoryOk] = useState(false)
  const [consented, setConsented] = useState(false)
  const [page, setPage] = useState<Page>({ name: 'people' })
  const [erasing, setErasing] = useState(false)
  // Archive mode: the embedded payload waits here until the user supplies its passphrase.
  const [locked, setLocked] = useState<{ bytes: Uint8Array; load: (pass?: string) => Promise<void> } | null>(
    null,
  )
  const archive = archivePayload()

  // biome-ignore lint/correctness/useExhaustiveDependencies: the payload is fixed for the page's life
  useEffect(() => {
    let db: Database
    let kb: Kb
    const refresh = async () => {
      const [persons, counts, relationships] = await Promise.all([
        listPersons(db),
        genotypeCounts(db),
        listRelationships(db),
      ])
      setState({ db, kb, persons, counts, relationships, refresh })
    }
    ;(async () => {
      try {
        ;[db, kb] = await Promise.all([
          archive ? openArchiveDb() : Database.open({ onTakenOver: () => setTakenOver(true) }),
          loadKb(),
        ])
        if (import.meta.env.DEV) (window as unknown as { __hearth: unknown }).__hearth = { db }
        if (archive) {
          const load = async (pass?: string) => {
            await restoreBytes(db, archive, pass)
            setLocked(null)
            setConsented(await hasConsent(db, 'first_launch'))
            await refresh()
          }
          if (readHeader(archive)?.encrypted) setLocked({ bytes: archive, load })
          else await load()
        } else {
          await backups.start(db, APP_VERSION)
          setConsented(await hasConsent(db, 'first_launch'))
          await refresh()
        }
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [])

  if (takenOver)
    return (
      <main>
        <div className="card notice">
          <p>Hearth was opened in another tab, which now owns the local database.</p>
          <button type="button" className="primary" onClick={() => location.reload()}>
            Use it here instead
          </button>
        </div>
      </main>
    )
  if (error)
    return (
      <main>
        <div className="card danger">Could not start: {error}</div>
      </main>
    )
  if (locked) return <ArchiveGate onUnlock={locked.load} />
  if (!state)
    return (
      <main>
        <p className="muted">{archive ? 'Opening archive…' : 'Opening local database…'}</p>
      </main>
    )
  if (!state.db.persistent && !memoryOk && !archive)
    return (
      <main>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Storage is not available</h2>
          <p>
            Hearth could not open its on-device database, so anything you import now would be lost on reload.
            Usually another Hearth tab still holds the storage: close it and retry. Private windows and some
            browsers do not offer persistent storage at all.
          </p>
          <p className="muted">Reason: {state.db.reason}</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => location.reload()}>
              Retry
            </button>
            <button type="button" className="danger" onClick={() => setMemoryOk(true)}>
              Continue without saving
            </button>
          </div>
        </div>
      </main>
    )
  if (!consented)
    return (
      <AppContext.Provider value={state}>
        <ConsentGate onDone={() => setConsented(true)} />
      </AppContext.Provider>
    )

  const nav = (p: Page, label: string) => (
    <button type="button" className={page.name === p.name ? 'active' : ''} onClick={() => setPage(p)}>
      {label}
    </button>
  )
  return (
    <AppContext.Provider value={state}>
      <header className="top">
        <span className="brand">Hearth</span>
        <nav>
          {nav({ name: 'people' }, 'People')}
          {nav({ name: 'family' }, 'Family lookup')}
          {nav({ name: 'ask' }, 'Ask')}
          {nav({ name: 'settings' }, 'Settings & export')}
        </nav>
        <span className="status">
          {state.persons.length} people · kb {state.kb.version} ·{' '}
          {archive
            ? 'archive, in memory'
            : state.db.persistent
              ? 'stored on this device'
              : 'memory only — export before closing'}
        </span>
        <button type="button" className="danger small" onClick={() => setErasing(true)}>
          Erase data
        </button>
      </header>
      {erasing && <EraseDialog onClose={() => setErasing(false)} />}
      {archive && (
        <div className="banner">
          Archive opened in memory. Nothing is stored in this browser; changes are kept only if you save a new
          archive from Settings.
        </div>
      )}
      {!state.db.persistent && !archive && (
        <div className="banner danger">
          Not saving: this session runs in memory and everything disappears on reload. Export a dump from
          Settings before closing.
        </div>
      )}
      <main>
        {page.name === 'people' && <PeoplePage onOpen={(id) => setPage({ name: 'person', id })} />}
        {page.name === 'person' && <PersonPage id={page.id} onBack={() => setPage({ name: 'people' })} />}
        {page.name === 'family' && <FamilyPage />}
        {page.name === 'ask' && <AskPage />}
        {page.name === 'settings' && <SettingsPage />}
      </main>
    </AppContext.Provider>
  )
}

/** Passphrase prompt shown before anything else when an archive's payload is encrypted. */
function ArchiveGate({ onUnlock }: { onUnlock: (pass: string) => Promise<void> }) {
  const [pass, setPass] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onUnlock(pass)
    } catch {
      setError('Wrong passphrase.')
      setBusy(false)
    }
  }
  return (
    <main>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>This archive is encrypted</h2>
        <p className="muted">Enter the passphrase it was saved with. Nothing is stored in this browser.</p>
        <div className="row">
          <label className="field">
            Passphrase
            <input
              type="password"
              value={pass}
              disabled={busy}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          <button type="button" className="primary" onClick={submit} disabled={busy || !pass}>
            {busy ? 'Opening…' : 'Open'}
          </button>
        </div>
        {error && <p className="danger">{error}</p>}
      </div>
    </main>
  )
}
