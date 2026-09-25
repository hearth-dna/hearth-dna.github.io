/**
 * Pages as URLs, so a page can be bookmarked, reloaded and reached with Back/Forward.
 * Pure: `parseRoute`/`formatRoute` know nothing about `window`; `useRoute` wires them to history.
 * Person ids in paths are random ids, never names; URLs stay in this browser.
 */
import { useCallback, useEffect, useState } from 'react'

export type Page =
  | { name: 'people' }
  | { name: 'person'; id: string }
  | { name: 'family' }
  /** `person` is '' for the whole family. */
  | { name: 'health'; person: string }
  | { name: 'charts' }
  | { name: 'ask' }
  | { name: 'settings' }

export const HOME: Page = { name: 'people' }

/** '/health-log/abc' → { name: 'health', person: 'abc' }; anything unknown → null. */
export function parseRoute(path: string): Page | null {
  const parts = path
    .split(/[?#]/)[0]
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s))
  const [head = '', id, ...rest] = parts
  if (rest.length) return null
  switch (head) {
    case '':
      return id === undefined ? HOME : null
    case 'people':
      return id === undefined ? HOME : { name: 'person', id }
    case 'health-log':
      return { name: 'health', person: id ?? '' }
    case 'family':
    case 'charts':
    case 'ask':
    case 'settings':
      return id === undefined ? { name: head } : null
    default:
      return null
  }
}

export function formatRoute(p: Page): string {
  switch (p.name) {
    case 'person':
      return `/people/${encodeURIComponent(p.id)}`
    case 'health':
      return p.person ? `/health-log/${encodeURIComponent(p.person)}` : '/health-log'
    default:
      return `/${p.name}`
  }
}

/**
 * The archive is a single HTML file opened from disk, where changing the path is not allowed,
 * so it keeps the route in the hash (`#/health-log`). The hosted app uses real paths and keeps
 * the query string (e.g. `?profile=`) untouched.
 */
const inHash = () => __HEARTH_ARCHIVE__ || location.protocol === 'file:'
const current = () => (inHash() ? location.hash.replace(/^#/, '') : location.pathname)
const href = (p: Page) =>
  inHash()
    ? `${location.pathname}${location.search}#${formatRoute(p)}`
    : `${formatRoute(p)}${location.search}`

export function useRoute(): [Page, (p: Page) => void] {
  const [page, setPage] = useState<Page>(() => parseRoute(current()) ?? HOME)

  // biome-ignore lint/correctness/useExhaustiveDependencies: normalise once on mount
  useEffect(() => {
    // Normalise unknown or aliased URLs ('/', '/people/') without adding a history entry.
    if (current() !== formatRoute(page)) history.replaceState(null, '', href(page))
    const onPop = () => setPage(parseRoute(current()) ?? HOME)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((p: Page) => {
    if (current() !== formatRoute(p)) history.pushState(null, '', href(p))
    setPage(p)
    window.scrollTo(0, 0)
  }, [])

  return [page, navigate]
}
