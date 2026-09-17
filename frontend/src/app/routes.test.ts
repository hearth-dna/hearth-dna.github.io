import { describe, expect, it } from 'vitest'
import { formatRoute, HOME, type Page, parseRoute } from './routes'

describe('routes', () => {
  const pages: Page[] = [
    HOME,
    { name: 'person', id: 'p-1' },
    { name: 'family' },
    { name: 'health', person: '' },
    { name: 'health', person: 'p 2' },
    { name: 'ask' },
    { name: 'settings' },
  ]
  it('round-trips every page', () => {
    for (const p of pages) expect(parseRoute(formatRoute(p))).toEqual(p)
  })
  it('uses readable paths', () => {
    expect(formatRoute({ name: 'health', person: '' })).toBe('/health-log')
    expect(formatRoute({ name: 'health', person: 'abc' })).toBe('/health-log/abc')
    expect(formatRoute({ name: 'person', id: 'abc' })).toBe('/people/abc')
  })
  it('accepts the root, trailing slashes and a query string', () => {
    expect(parseRoute('/')).toEqual(HOME)
    expect(parseRoute('')).toEqual(HOME)
    expect(parseRoute('/health-log/')).toEqual({ name: 'health', person: '' })
    expect(parseRoute('/ask?profile=test')).toEqual({ name: 'ask' })
  })
  it('rejects unknown paths', () => {
    expect(parseRoute('/nope')).toBeNull()
    expect(parseRoute('/ask/extra')).toBeNull()
    expect(parseRoute('/people/a/b')).toBeNull()
  })
})
