// Copies the web's string catalogue into the native apps (ADR 0010): one merged en.json from
// src/i18n/en/*.json, and each flat locale file as it is. Usage: node mobile-i18n.mjs <dir>...
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const src = new URL('../src/i18n/', import.meta.url).pathname
const en = {}
for (const f of readdirSync(`${src}en`).filter((f) => f.endsWith('.json')).sort())
  Object.assign(en, JSON.parse(readFileSync(`${src}en/${f}`, 'utf8')))
const locales = readdirSync(`${src}locales`).filter((f) => f.endsWith('.json'))

for (const out of process.argv.slice(2)) {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  writeFileSync(`${out}/en.json`, JSON.stringify(en))
  for (const f of locales) copyFileSync(`${src}locales/${f}`, `${out}/${f}`)
  console.log(`${locales.length + 1} languages -> ${out}`)
}
