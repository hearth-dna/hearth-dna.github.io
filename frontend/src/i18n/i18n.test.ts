import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EN, interpolate, translate } from './i18n'
import { detectLanguage, LANGUAGES } from './languages'

const localeDir = `${__dirname}/locales`
const shipped = readdirSync(localeDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))

describe('languages', () => {
  it('ships twenty languages with a locale file for each non-English one', () => {
    expect(LANGUAGES.length).toBe(20)
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(20)
    for (const l of LANGUAGES) if (l.code !== 'en') expect(shipped).toContain(l.code)
    for (const code of shipped) expect(LANGUAGES.some((l) => l.code === code)).toBe(true)
  })
  it('detects from the browser list on the primary subtag', () => {
    expect(detectLanguage(['pt-BR', 'en-US'])).toBe('pt')
    expect(detectLanguage(['xx', 'zh-Hans-CN'])).toBe('zh')
    expect(detectLanguage(['xx'])).toBe('en')
    expect(detectLanguage([])).toBe('en')
  })
})

describe('translate', () => {
  it('interpolates, falls back to English, then to the key', () => {
    expect(interpolate('{n} people', { n: 3 })).toBe('3 people')
    expect(interpolate('{n} of {m}', { n: 1 })).toBe('1 of {m}')
    expect(translate({}, 'common.cancel')).toBe('Cancel')
    expect(translate({ 'common.cancel': 'Abbrechen' }, 'common.cancel')).toBe('Abbrechen')
    expect(translate({}, 'nope.nope')).toBe('nope.nope')
  })
})

describe('locales', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  const tags = (s: string) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort()
  for (const code of shipped) {
    it(`${code} has every English key, with the same placeholders and tags`, () => {
      const dict = JSON.parse(readFileSync(`${localeDir}/${code}.json`, 'utf8')) as Record<string, string>
      const missing = Object.keys(EN).filter((k) => !(k in dict))
      const extra = Object.keys(dict).filter((k) => !(k in EN))
      expect(missing, 'missing keys').toEqual([])
      expect(extra, 'unknown keys').toEqual([])
      for (const [k, v] of Object.entries(dict)) {
        expect(typeof v, k).toBe('string')
        expect(v.trim(), k).not.toBe('')
        expect(placeholders(v), `${k} placeholders`).toEqual(placeholders(EN[k]))
        expect(tags(v), `${k} tags`).toEqual(tags(EN[k]))
      }
    })
  }
})
