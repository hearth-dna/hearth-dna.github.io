import { describe, expect, it } from 'vitest'
import { ASSISTANTS, assistantUrl, MAX_URL } from './assistants'

const by = (id: string) => ASSISTANTS.find((a) => a.id === id) ?? ASSISTANTS[0]

describe('assistant links', () => {
  it('puts the text, encoded, in each provider’s prefill parameter', () => {
    const text = 'Person A: CYP2C19 *2/*2 & clopidogrel?\nПочему?'
    for (const a of ASSISTANTS) {
      const url = new URL(assistantUrl(a, text) ?? '')
      expect(url.protocol, a.id).toBe('https:')
      expect(url.searchParams.get('q'), a.id).toBe(text)
    }
    expect(assistantUrl(by('google'), 'x')).toBe('https://www.google.com/search?udm=50&q=x')
    expect(assistantUrl(by('claude'), 'x')).toBe('https://claude.ai/new?q=x')
  })

  it('refuses a text too long for an address', () => {
    expect(assistantUrl(by('chatgpt'), 'a'.repeat(MAX_URL))).toBeNull()
    expect(assistantUrl(by('chatgpt'), 'a'.repeat(MAX_URL - 100))).not.toBeNull()
  })
})
