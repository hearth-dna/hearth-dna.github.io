import { describe, expect, it } from 'vitest'
import { decodePayload, encodePayload, extractPayload, PAYLOAD_PLACEHOLDER, splicePayload } from './payload'

const template = `<html><head><script type="application/x-hearth-archive" id="hearth-data">${PAYLOAD_PLACEHOLDER}</script></head><body></body></html>`

describe('archive payload', () => {
  it('round-trips bytes through base64 lines', () => {
    const bytes = new Uint8Array(1000).map((_, i) => (i * 7) & 0xff)
    const b64 = encodePayload(bytes)
    expect(b64.split('\n').every((l) => l.length <= 76)).toBe(true)
    expect(decodePayload(b64)).toEqual(bytes)
  })

  it('treats the template as having no payload', () => {
    expect(extractPayload(template)).toBeNull()
    expect(extractPayload('<html></html>')).toBeNull()
  })

  it('splices a payload in and reads it back, replacing an older one', () => {
    const once = splicePayload(template, 'AAAA')
    expect(extractPayload(once)).toBe('AAAA')
    const twice = splicePayload(once, 'BBBB')
    expect(extractPayload(twice)).toBe('BBBB')
    expect(twice).not.toContain('AAAA')
  })
})
