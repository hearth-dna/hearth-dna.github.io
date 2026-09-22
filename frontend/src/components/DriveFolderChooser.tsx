import { useEffect, useState } from 'react'
import type { DriveFolder } from '../backup/cloud'
import type { DriveBrowser } from '../backup/folder'
import { useT } from '../i18n/context'

type Chosen = DriveFolder & { path: string }
type Children = DriveFolder[] | 'loading' | { error: string }

const SEARCH_DELAY_MS = 350

/**
 * Picks the Google Drive folder backups go to (ADR 0009). Three ways in, because a real Drive has
 * hundreds of folders: the folders that already hold a Hearth backup (another device's), a search
 * by name, and a tree that opens one level at a time. The folder is only chosen by the final button,
 * so browsing never changes anything.
 */
export function DriveFolderChooser({
  browser,
  onDone,
}: {
  browser: DriveBrowser
  onDone: (f: Chosen | null) => void
}) {
  const t = useT()
  const myDrive = t('driveFolder.myDrive')
  const [children, setChildren] = useState<Record<string, Children>>({})
  const [open, setOpen] = useState<Set<string>>(new Set(['root']))
  const [selected, setSelected] = useState<Chosen | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Chosen[] | 'loading' | null>(null)
  const [backups, setBackups] = useState<Chosen[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  /** A folder with its path from My Drive, for folders found outside the tree. */
  const withPath = async (f: DriveFolder): Promise<Chosen> => ({
    ...f,
    path: [myDrive, ...(await browser.path(f.id)).map((p) => p.name)].join(' › '),
  })

  const load = (id: string) => {
    setChildren((c) => ({ ...c, [id]: 'loading' }))
    browser.list(id).then(
      (list) => setChildren((c) => ({ ...c, [id]: list })),
      (e) => setChildren((c) => ({ ...c, [id]: { error: String(e) } })),
    )
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per browser; load and withPath only close over it
  useEffect(() => {
    load('root')
    browser
      .withBackup()
      .then((found) => Promise.all(found.map(withPath)))
      .then((found) => {
        setBackups(found)
        // The likeliest answer: the folder another device already backs up to.
        if (found.length === 1) setSelected((s) => s ?? found[0])
      })
      .catch(() => {})
  }, [browser])

  // biome-ignore lint/correctness/useExhaustiveDependencies: withPath only closes over the browser
  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) return setResults(null)
    setResults('loading')
    let live = true
    const timer = setTimeout(() => {
      browser
        .search(text)
        .then((found) => Promise.all(found.map(withPath)))
        .then(
          (found) => live && setResults(found),
          (e) => {
            if (!live) return
            setResults([])
            setError(String(e))
          },
        )
    }, SEARCH_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, browser])

  const toggle = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else {
      next.add(id)
      if (!children[id]) load(id)
    }
    setOpen(next)
  }

  const create = async () => {
    const name = newName.trim()
    const parent = selected ?? { id: 'root', name: myDrive, path: myDrive }
    if (!name) return
    try {
      const made = await browser.create(parent.id, name)
      setNewName('')
      // Show it where it was made, and choose it: making a folder is nearly always for this.
      setOpen((o) => new Set(o).add(parent.id))
      load(parent.id)
      setSelected({ ...made, path: `${parent.path} › ${made.name}` })
    } catch (e) {
      setError(String(e))
    }
  }

  const row = (f: Chosen, key: string) => (
    <li key={key}>
      <button
        type="button"
        className={`drive-row${selected?.id === f.id ? ' selected' : ''}`}
        aria-pressed={selected?.id === f.id}
        onClick={() => setSelected(f)}
      >
        <span>{f.name}</span>
        <span className="muted small">{f.path}</span>
      </button>
    </li>
  )

  const tree = (folder: DriveFolder, trail: string[], depth: number) => {
    const path = [...trail, folder.name].join(' › ')
    const isOpen = open.has(folder.id)
    const kids = children[folder.id]
    return (
      <li key={folder.id}>
        <div className="drive-node" style={{ paddingInlineStart: `${depth * 1.1}rem` }}>
          <button
            type="button"
            className="drive-toggle"
            aria-expanded={isOpen}
            aria-label={t('driveFolder.expand', { name: folder.name })}
            onClick={() => toggle(folder.id)}
          >
            {isOpen ? '▾' : '▸'}
          </button>
          <button
            type="button"
            className={`drive-row${selected?.id === folder.id ? ' selected' : ''}`}
            aria-pressed={selected?.id === folder.id}
            onClick={() => setSelected({ ...folder, path })}
          >
            {folder.name}
          </button>
        </div>
        {isOpen && (
          <ul className="drive-tree">
            {kids === 'loading' && (
              <li className="muted small" style={{ paddingInlineStart: `${(depth + 1) * 1.1 + 1.6}rem` }}>
                {t('driveFolder.loading')}
              </li>
            )}
            {kids && typeof kids === 'object' && 'error' in kids && <li className="danger">{kids.error}</li>}
            {Array.isArray(kids) && kids.length === 0 && (
              <li className="muted small" style={{ paddingInlineStart: `${(depth + 1) * 1.1 + 1.6}rem` }}>
                {t('driveFolder.empty')}
              </li>
            )}
            {Array.isArray(kids) && kids.map((k) => tree(k, [...trail, folder.name], depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className="notice drive-folders">
      <p>
        <b>{t('driveFolder.title')}</b>
      </p>
      <input
        type="search"
        className="drive-search"
        value={query}
        placeholder={t('driveFolder.search')}
        aria-label={t('driveFolder.search')}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="drive-scroll">
        {results !== null ? (
          results === 'loading' ? (
            <p className="muted">{t('driveFolder.searching')}</p>
          ) : results.length === 0 ? (
            <p className="muted">{t('driveFolder.noMatches')}</p>
          ) : (
            <ul className="drive-tree">{results.map((f) => row(f, `s-${f.id}`))}</ul>
          )
        ) : (
          <>
            {backups.length > 0 && (
              <>
                <p className="muted small">{t('driveFolder.withBackup')}</p>
                <ul className="drive-tree">{backups.map((f) => row(f, `b-${f.id}`))}</ul>
              </>
            )}
            <ul className="drive-tree">{tree({ id: 'root', name: myDrive }, [], 0)}</ul>
          </>
        )}
      </div>
      <p className="drive-selected">
        {selected ? t('driveFolder.selected', { path: selected.path }) : t('driveFolder.pickOne')}
      </p>
      <div className="row">
        <input
          value={newName}
          placeholder={t('driveFolder.newFolder')}
          aria-label={t('driveFolder.newFolder')}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="button" disabled={!newName.trim()} onClick={create}>
          {t('driveFolder.create')}
        </button>
      </div>
      {error && <p className="danger">{error}</p>}
      <div className="row">
        <button type="button" className="primary" disabled={!selected} onClick={() => onDone(selected)}>
          {t('driveFolder.use')}
        </button>
        <button type="button" onClick={() => onDone(null)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
