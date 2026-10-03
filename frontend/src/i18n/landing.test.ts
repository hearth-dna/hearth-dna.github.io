import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LANGUAGES } from './languages'

// The landing page at the site root (landing/, ADR 0011) is plain HTML with its own strings.
const dir = `${__dirname}/../../../landing`
const html = readFileSync(`${dir}/index.html`, 'utf8')
const keys = [...html.matchAll(/data-i18n(?:-html|-aria|-title|-content)?="([^"]+)"/g)].map((m) => m[1])
const htmlKeys = [...html.matchAll(/data-i18n-html="([^"]+)"/g)].map((m) => m[1])
const options = [...html.matchAll(/<option value="([^"]+)"( data-dir="rtl")?>([^<]+)</g)]
const files = readdirSync(`${dir}/i18n`).filter((f) => f.endsWith('.json'))

describe('landing page languages', () => {
  it('offers exactly the languages the app ships, with their names and direction', () => {
    expect(options.map((o) => [o[1], o[3], o[2] ? 'rtl' : 'ltr'])).toEqual(
      LANGUAGES.map((l) => [l.code, l.name, l.dir]),
    )
    expect(files.map((f) => f.slice(0, -5)).sort()).toEqual(
      LANGUAGES.filter((l) => l.code !== 'en')
        .map((l) => l.code)
        .sort(),
    )
  })

  for (const f of files) {
    it(`${f} has every string of the page and nothing else`, () => {
      const dict = JSON.parse(readFileSync(`${dir}/i18n/${f}`, 'utf8')) as Record<string, string>
      expect(Object.keys(dict).sort()).toEqual([...new Set(keys)].sort())
      for (const [k, v] of Object.entries(dict)) {
        expect(v.trim(), k).not.toBe('')
        // Strings set as HTML may only emphasise; everything else is plain text.
        const tags = [...v.matchAll(/<\/?(\w+)/g)].map((m) => m[1])
        if (htmlKeys.includes(k))
          expect(
            tags.every((t) => t === 'strong'),
            k,
          ).toBe(true)
        else expect(tags, k).toEqual([])
      }
    })
  }
})
