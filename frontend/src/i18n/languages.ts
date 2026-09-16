/** The 20 UI languages, ordered by number of speakers. `dir` drives the document direction. */
export interface Language {
  code: string
  /** Endonym, shown in the language picker so every reader finds their own. */
  name: string
  dir: 'ltr' | 'rtl'
}

export const LANGUAGES: readonly Language[] = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'zh', name: '中文（简体）', dir: 'ltr' },
  { code: 'hi', name: 'हिन्दी', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'bn', name: 'বাংলা', dir: 'ltr' },
  { code: 'pt', name: 'Português', dir: 'ltr' },
  { code: 'ru', name: 'Русский', dir: 'ltr' },
  { code: 'ur', name: 'اردو', dir: 'rtl' },
  { code: 'id', name: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
  { code: 'ja', name: '日本語', dir: 'ltr' },
  { code: 'tr', name: 'Türkçe', dir: 'ltr' },
  { code: 'ko', name: '한국어', dir: 'ltr' },
  { code: 'vi', name: 'Tiếng Việt', dir: 'ltr' },
  { code: 'it', name: 'Italiano', dir: 'ltr' },
  { code: 'pl', name: 'Polski', dir: 'ltr' },
  { code: 'uk', name: 'Українська', dir: 'ltr' },
  { code: 'nl', name: 'Nederlands', dir: 'ltr' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']
export const DEFAULT_LANGUAGE: LanguageCode = 'en'

export function isLanguage(code: string): code is LanguageCode {
  return LANGUAGES.some((l) => l.code === code)
}

/** First browser language we ship, matched on the primary subtag (`pt-BR` → `pt`); English otherwise. */
export function detectLanguage(preferred: readonly string[]): LanguageCode {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0]
    if (isLanguage(primary)) return primary
  }
  return DEFAULT_LANGUAGE
}
