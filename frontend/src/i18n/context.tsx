import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { type Dict, EN, loadDict, type Params, translate } from './i18n'
import { DEFAULT_LANGUAGE, detectLanguage, isLanguage, LANGUAGES, type LanguageCode } from './languages'

/** localStorage key for the chosen language; a preference, not personal data. */
const STORAGE_KEY = 'hearth.language'

export type Translate = (key: string, params?: Params) => string

interface I18n {
  lang: LanguageCode
  t: Translate
  setLang: (code: LanguageCode) => void
}

const I18nContext = createContext<I18n | null>(null)

export function initialLanguage(): LanguageCode {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
  if (stored && isLanguage(stored)) return stored
  return detectLanguage(typeof navigator === 'undefined' ? [] : navigator.languages)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(initialLanguage)
  const [dict, setDict] = useState<Dict>(EN)

  useEffect(() => {
    let live = true
    loadDict(lang).then((d) => live && setDict(d))
    const l = LANGUAGES.find((x) => x.code === lang)!
    document.documentElement.lang = lang
    document.documentElement.dir = l.dir
    return () => {
      live = false
    }
  }, [lang])

  const setLang = useCallback((code: LanguageCode) => {
    localStorage.setItem(STORAGE_KEY, code)
    setLangState(code)
  }, [])
  const t = useCallback<Translate>((key, params) => translate(dict, key, params), [dict])
  const value = useMemo(() => ({ lang, t, setLang }), [lang, t, setLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT(): Translate {
  return useI18n().t
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('I18nProvider missing')
  return ctx
}

export type RichParts = Record<string, (chunk: ReactNode) => ReactNode>

/**
 * Renders a message containing `<b>`, `<em>`, `<code>` or custom tags. Custom tags (`<a>`,
 * `<0>`) need a renderer in `parts`; built-ins render as themselves. Tags do not nest.
 */
export function rich(msg: string, parts: RichParts = {}): ReactNode[] {
  const out: ReactNode[] = []
  const re = /<(\w+)>(.*?)<\/\1>/gs
  let last = 0
  let m: RegExpExecArray | null = re.exec(msg)
  while (m !== null) {
    if (m.index > last) out.push(msg.slice(last, m.index))
    const [, tag, inner] = m
    const key = out.length
    const render = parts[tag]
    if (render) out.push(<span key={key}>{render(inner)}</span>)
    else if (tag === 'b') out.push(<strong key={key}>{inner}</strong>)
    else if (tag === 'em') out.push(<em key={key}>{inner}</em>)
    else if (tag === 'code') out.push(<code key={key}>{inner}</code>)
    else out.push(inner)
    last = m.index + m[0].length
    m = re.exec(msg)
  }
  if (last < msg.length) out.push(msg.slice(last))
  return out
}

export { DEFAULT_LANGUAGE, LANGUAGES }
