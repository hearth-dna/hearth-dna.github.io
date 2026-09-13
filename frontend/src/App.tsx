import { useEffect, useState } from 'react'
import { AppContext, type AppState } from './app/context'
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
        ;[db, kb] = await Promise.all([Database.open(() => setTakenOver(true)), loadKb()])
        if (import.meta.env.DEV) (window as unknown as { __hearth: unknown }).__hearth = { db }
        setConsented(await hasConsent(db, 'first_launch'))
        await refresh()
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
  if (!state)
    return (
      <main>
        <p className="muted">Opening local database…</p>
      </main>
    )
  if (!state.db.persistent && !memoryOk)
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
          {state.db.persistent ? 'stored on this device' : 'memory only — export before closing'}
        </span>
        <button type="button" className="danger small" onClick={() => setErasing(true)}>
          Erase data
        </button>
      </header>
      {erasing && <EraseDialog onClose={() => setErasing(false)} />}
      {!state.db.persistent && (
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
