/**
 * Chat assistants a context pack can be opened in with the text already in the box. The text rides
 * in the address (`?q=`), so it reaches the provider and the browser history: the pack preview
 * confirms and logs each one like a copy. Opened as an ordinary link, which the phone apps hand
 * to the system browser.
 */

export interface Assistant {
  id: 'chatgpt' | 'claude' | 'mistral' | 'google'
  name: string
  url: (text: string) => string
}

const q = (base: string) => (text: string) => `${base}${encodeURIComponent(text)}`

export const ASSISTANTS: Assistant[] = [
  { id: 'chatgpt', name: 'ChatGPT', url: q('https://chatgpt.com/?q=') },
  { id: 'claude', name: 'Claude', url: q('https://claude.ai/new?q=') },
  { id: 'mistral', name: 'Mistral', url: q('https://chat.mistral.ai/chat?q=') },
  // Google search in AI Mode (udm=50).
  { id: 'google', name: 'Google AI Mode', url: q('https://www.google.com/search?udm=50&q=') },
]

/** Longer addresses are cut or refused by browsers and servers; such a pack is copied instead. */
export const MAX_URL = 8000

/** The prefilled address, or null when the text is too long to travel in one. */
export function assistantUrl(a: Assistant, text: string): string | null {
  const url = a.url(text)
  return url.length <= MAX_URL ? url : null
}
