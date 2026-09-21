import type { ReactNode } from 'react'
import type { Page } from '../app/routes'
import { useT } from '../i18n/context'

/** 24-unit outline icons, drawn in the current colour so the active tint reaches them. */
const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    {path}
  </svg>
)

const ICONS = {
  people: icon(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
    </>,
  ),
  family: icon(
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>,
  ),
  health: icon(
    <path d="M12 20.5s-8.5-5-8.5-11A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.5 2.9c0 6-8.5 11-8.5 11Z" />,
  ),
  ask: icon(
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5Z" />,
  ),
  settings: icon(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    </>,
  ),
}

/**
 * The phone's primary navigation: a bottom bar with the five top-level pages, which is where both
 * iOS (tab bar) and Android (Material 3 navigation bar) put three to five destinations. Hidden on
 * wide screens by CSS, where the header nav does the same job.
 */
export function TabBar({ page, onPage }: { page: Page; onPage: (p: Page) => void }) {
  const t = useT()
  const tabs: { page: Page; key: keyof typeof ICONS; label: string }[] = [
    { page: { name: 'people' }, key: 'people', label: t('app.navPeople') },
    { page: { name: 'family' }, key: 'family', label: t('app.tabFamily') },
    { page: { name: 'health', person: '' }, key: 'health', label: t('app.navHealth') },
    { page: { name: 'ask' }, key: 'ask', label: t('app.navAsk') },
    { page: { name: 'settings' }, key: 'settings', label: t('app.tabSettings') },
  ]
  // A person's report belongs to People: the tab stays lit while you are inside it.
  const current = page.name === 'person' ? 'people' : page.name
  return (
    <nav className="tabbar">
      {tabs.map((tab) => {
        const active = current === tab.key
        return (
          <button
            type="button"
            key={tab.key}
            className={active ? 'active' : ''}
            aria-current={active ? 'page' : undefined}
            onClick={() => (active ? window.scrollTo({ top: 0, behavior: 'smooth' }) : onPage(tab.page))}
          >
            <span className="tabicon">{ICONS[tab.key]}</span>
            <span className="tablabel">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
