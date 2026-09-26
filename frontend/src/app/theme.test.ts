import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTheme, nextTheme, readTheme } from './theme'

describe('theme', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('cycles system → light → dark → system', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })

  it('reads a stored choice and falls back to system for anything else', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null })
    expect(readTheme()).toBe('system')
    store.set('hearth.theme', 'dark')
    expect(readTheme()).toBe('dark')
    store.set('hearth.theme', 'purple')
    expect(readTheme()).toBe('system')
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readTheme()).toBe('system')
    expect(isTheme('light')).toBe(true)
  })
})
