import { useSyncExternalStore } from 'react'

/**
 * Light / dark theme. `system` follows the device (the CSS media query); `light` and `dark` are
 * forced through `<html data-theme>`. A per-device preference kept in localStorage like the
 * language; it is not personal data and not part of a dump.
 */
export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

const STORAGE_KEY = 'hearth.theme'
const listeners = new Set<() => void>()

export const isTheme = (v: unknown): v is Theme => THEMES.includes(v as Theme)

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isTheme(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/** The mode after this one in the header button's cycle. */
export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]

let current: Theme = typeof localStorage === 'undefined' ? 'system' : readTheme()

export function applyTheme(t: Theme): void {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
}

export function setTheme(t: Theme): void {
  try {
    if (t === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, t)
  } catch {
    // Storage blocked (private mode): the choice still applies until the page closes.
  }
  current = t
  applyTheme(t)
  for (const l of listeners) l()
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
