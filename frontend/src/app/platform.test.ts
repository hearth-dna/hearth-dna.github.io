import { describe, expect, it } from 'vitest'
import { detectPlatform } from './platform'

describe('detectPlatform', () => {
  it('knows an iPhone WKWebView', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    expect(detectPlatform(ua, 5)).toBe('ios')
  })
  it('tells an iPad from a Mac by its touch screen', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    expect(detectPlatform(ua, 5)).toBe('ios')
    expect(detectPlatform(ua, 0)).toBe('other')
  })
  it('knows an Android WebView', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36'
    expect(detectPlatform(ua, 5)).toBe('android')
  })
  it('leaves a desktop browser alone', () => {
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36', 0)).toBe('other')
  })
})
