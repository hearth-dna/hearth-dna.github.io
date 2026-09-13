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
        ;[db, kb] = await Promise.all([Database.open(), loadKb()])
        if (import.meta.env.DEV) (window as unknown as { __hearth: unknown }).__hearth = { db }
        setConsented(await hasConsent(db, 'first_launch'))
        await refresh()
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [])

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
