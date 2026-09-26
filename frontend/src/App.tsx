import { useEffect, useRef, useState } from 'react'
import { APP_VERSION, AppContext, type AppState } from './app/context'
import { type Page, useRoute } from './app/routes'
import { StartupLog, type StepState } from './app/startup'
import { nextTheme, setTheme, useTheme } from './app/theme'
import { archivePayload, openArchiveDb } from './archive/mode'
import { backups } from './backup/scheduler'
import { AskPage } from './components/AskPage'
import { ChartsPage } from './components/ChartsPage'
import { ConsentGate } from './components/ConsentGate'
import { EraseDialog } from './components/EraseDialog'
import { FamilyPage } from './components/FamilyPage'
import { HealthPage } from './components/HealthPage'
import { Icon, type IconName } from './components/Icon'
import { ImportPage } from './components/ImportPage'
import { MoreSheet } from './components/MoreSheet'
import { PeoplePage } from './components/PeoplePage'
import { PersonPage } from './components/PersonPage'
import { SettingsPage } from './components/SettingsPage'
import { StartupScreen } from './components/StartupScreen'
import { SyncButton } from './components/SyncButton'
import { hasConsent } from './consent/consent'
import { Database } from './db/db'
import { genotypeCounts, listPersons, listRelationships } from './db/repo'
import { readHeader } from './export/container'
import { restoreBytes } from './export/restore'
import { useT } from './i18n/context'
import { type Kb, loadKb } from './kb/kb'

export function App() {
  const t = useT()
  const [loaded, setState] = useState<Omit<AppState, 'go'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [takenOver, setTakenOver] = useState(false)
  const [memoryOk, setMemoryOk] = useState(false)
  const [consented, setConsented] = useState(false)
  const [page, setPage] = useRoute()
  const state: AppState | null = loaded && { ...loaded, go: setPage }
  const [erasing, setErasing] = useState(false)
  const [more, setMore] = useState(false)
  const theme = useTheme()
  const [steps, setSteps] = useState<StepState[]>([])
  const [startup] = useState(() => new StartupLog(setSteps))
  // StrictMode runs effects twice in dev; the start-up sequence must run once.
  const booted = useRef(false)
  // Archive mode: the embedded payload waits here until the user supplies its passphrase.
  const [locked, setLocked] = useState<{ bytes: Uint8Array; load: (pass?: string) => Promise<void> } | null>(
    null,
  )
  const archive = archivePayload()

  // biome-ignore lint/correctness/useExhaustiveDependencies: the payload is fixed for the page's life
  useEffect(() => {
    if (booted.current) return
    booted.current = true
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
    // The first load goes step by step so the start screen can name what is slow.
    const firstLoad = async () => {
      const [persons, relationships] = await startup.run('people', () =>
        Promise.all([listPersons(db), listRelationships(db)]),
      )
      const counts = await startup.run('genotypes', () => genotypeCounts(db))
      setState({ db, kb, persons, counts, relationships, refresh })
    }
    ;(async () => {
      try {
        ;[db, kb] = await Promise.all([
          archive
            ? openArchiveDb(startup)
            : Database.open({ onTakenOver: () => setTakenOver(true), log: startup }),
          startup.run('kb', loadKb),
        ])
        if (import.meta.env.DEV) (window as unknown as { __hearth: unknown }).__hearth = { db }
        if (archive) {
          const load = async (pass?: string) => {
            await startup.run('archive', () => restoreBytes(db, archive, pass))
            setLocked(null)
            setConsented(await hasConsent(db, 'first_launch'))
            await firstLoad()
          }
          if (readHeader(archive)?.encrypted) setLocked({ bytes: archive, load })
          else await load()
        } else {
          backups.onLoaded = () => void refresh()
          await startup.run('backup', () => backups.start(db, APP_VERSION))
          setConsented(await hasConsent(db, 'first_launch'))
          await firstLoad()
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
          <p>{t('app.takenOver')}</p>
          <button type="button" className="primary" onClick={() => location.reload()}>
            {t('app.useHere')}
          </button>
        </div>
      </main>
    )
  if (error) return <StartupScreen steps={steps} startedAt={startup.startedAt} error={error} />
  if (locked) return <ArchiveGate onUnlock={locked.load} />
  if (!state) return <StartupScreen steps={steps} startedAt={startup.startedAt} />
  if (!state.db.persistent && !memoryOk && !archive)
    return (
      <main>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t('app.storageTitle')}</h2>
          <p>{t('app.storageIntro')}</p>
          <p className="muted">{t('app.storageReason', { reason: state.db.reason })}</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => location.reload()}>
              {t('common.retry')}
            </button>
            <button type="button" className="danger" onClick={() => setMemoryOk(true)}>
              {t('app.continueWithoutSaving')}
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

  const NAV: { page: Page; label: string; icon: IconName; tab: boolean }[] = [
    { page: { name: 'people' }, label: t('app.navPeople'), icon: 'people', tab: true },
    { page: { name: 'family' }, label: t('app.navFamily'), icon: 'family', tab: false },
    { page: { name: 'health', person: '' }, label: t('app.navHealth'), icon: 'health', tab: true },
    {
      page: { name: 'import', source: '', person: '' },
      label: t('app.navImport'),
      icon: 'import',
      tab: true,
    },
    { page: { name: 'charts' }, label: t('app.navCharts'), icon: 'charts', tab: true },
    { page: { name: 'ask' }, label: t('app.navAsk'), icon: 'ask', tab: true },
    { page: { name: 'settings' }, label: t('app.navSettings'), icon: 'settings', tab: false },
  ]
  // The person page belongs to People for the purpose of "where am I".
  const current = (p: Page) => page.name === p.name || (page.name === 'person' && p.name === 'people')
  const go = (p: Page) => {
    setMore(false)
    setPage(p)
  }
  const status = t('app.status', {
    people: state.persons.length,
    kb: state.kb.version,
    storage: archive
      ? t('app.storageArchive')
      : state.db.persistent
        ? t('app.storageDevice')
        : t('app.storageMemory'),
  })
  const erase = (
    <button type="button" className="danger small erase" onClick={() => setErasing(true)}>
      {t('app.eraseData')}
    </button>
  )
  return (
    <AppContext.Provider value={state}>
      <header className="top">
        <span className="brand">
          <Icon name="brand" size={22} />
          Hearth
        </span>
        <nav className="topnav">
          {NAV.map((n) => (
            <button
              key={n.page.name}
              type="button"
              className={current(n.page) ? 'active' : ''}
              aria-current={current(n.page) ? 'page' : undefined}
              onClick={() => go(n.page)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="tools">
          <button
            type="button"
            className="small ghost"
            aria-label={t('app.theme', { mode: t(`theme.${theme}`) })}
            title={t('app.theme', { mode: t(`theme.${theme}`) })}
            onClick={() => setTheme(nextTheme(theme))}
          >
            <Icon name={theme} size={18} />
          </button>
          {!archive && <SyncButton onOpenSettings={() => go({ name: 'settings' })} />}
          <span className="status" title={status}>
            {status}
          </span>
          {erase}
        </div>
      </header>
      <nav className="tabbar">
        {NAV.filter((n) => n.tab).map((n) => (
          <button
            key={n.page.name}
            type="button"
            aria-current={current(n.page) ? 'page' : undefined}
            onClick={() => go(n.page)}
          >
            <Icon name={n.icon} />
            {n.label}
          </button>
        ))}
        <button
          type="button"
          aria-current={NAV.some((n) => !n.tab && current(n.page)) ? 'page' : undefined}
          onClick={() => setMore(true)}
        >
          <Icon name="more" />
          {t('app.navMore')}
        </button>
      </nav>
      {more && (
        <MoreSheet onClose={() => setMore(false)}>
          {NAV.filter((n) => !n.tab).map((n) => (
            <button key={n.page.name} type="button" onClick={() => go(n.page)}>
              <Icon name={n.icon} />
              {n.label}
            </button>
          ))}
          <p className="muted">{status}</p>
          {erase}
        </MoreSheet>
      )}
      {erasing && <EraseDialog onClose={() => setErasing(false)} />}
      {archive && <div className="banner">{t('app.archiveBanner')}</div>}
      {!state.db.persistent && !archive && <div className="banner danger">{t('app.memoryBanner')}</div>}
      <main>
        {page.name === 'people' && <PeoplePage onOpen={(id) => setPage({ name: 'person', id })} />}
        {page.name === 'person' && <PersonPage id={page.id} onBack={() => setPage({ name: 'people' })} />}
        {page.name === 'family' && <FamilyPage />}
        {page.name === 'health' && (
          <HealthPage person={page.person} onPerson={(person) => setPage({ name: 'health', person })} />
        )}
        {page.name === 'import' && <ImportPage source={page.source} person={page.person} />}
        {page.name === 'charts' && <ChartsPage />}
        {page.name === 'ask' && <AskPage />}
        {page.name === 'settings' && <SettingsPage />}
      </main>
    </AppContext.Provider>
  )
}

/** Passphrase prompt shown before anything else when an archive's payload is encrypted. */
function ArchiveGate({ onUnlock }: { onUnlock: (pass: string) => Promise<void> }) {
  const t = useT()
  const [pass, setPass] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onUnlock(pass)
    } catch {
      setError(t('app.wrongPassphrase'))
      setBusy(false)
    }
  }
  return (
    <main>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('app.archiveEncrypted')}</h2>
        <p className="muted">{t('app.archiveHint')}</p>
        <div className="row">
          <label className="field">
            {t('app.passphrase')}
            <input
              type="password"
              value={pass}
              disabled={busy}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          <button type="button" className="primary" onClick={submit} disabled={busy || !pass}>
            {busy ? t('app.opening') : t('app.open')}
          </button>
        </div>
        {error && <p className="danger">{error}</p>}
      </div>
    </main>
  )
}
