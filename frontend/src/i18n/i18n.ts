import { DEFAULT_LANGUAGE, type LanguageCode } from './languages'

/**
 * Minimal string catalogue. English lives in `en/*.json`, one file per screen, keyed
 * `<screen>.<name>`; every other language is one flat `locales/<code>.json` with the same keys
 * (a test enforces parity). Messages interpolate `{name}` and may carry `<b>`, `<em>`, `<code>`
 * or `<a>` tags that `rich()` in context.tsx turns into elements. Missing keys fall back to
 * English, then to the key itself, so a half-translated locale never blanks the UI.
 */
export type Dict = Record<string, string>
export type Params = Record<string, string | number>

const enFiles = import.meta.glob<Dict>('./en/*.json', { eager: true, import: 'default' })
export const EN: Dict = Object.assign({}, ...Object.values(enFiles))

const localeFiles = import.meta.glob<Dict>('./locales/*.json', { import: 'default' })

export async function loadDict(code: LanguageCode): Promise<Dict> {
  if (code === DEFAULT_LANGUAGE) return EN
  const load = localeFiles[`./locales/${code}.json`]
  return load ? await load() : EN
}

export function interpolate(msg: string, params?: Params): string {
  if (!params) return msg
  return msg.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}

export function translate(dict: Dict, key: string, params?: Params): string {
  const msg = dict[key] ?? EN[key]
  if (msg === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key ${key}`)
    return key
  }
  return interpolate(msg, params)
}
