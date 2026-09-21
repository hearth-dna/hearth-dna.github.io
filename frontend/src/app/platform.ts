/**
 * Which phone platform's conventions the chrome follows: iOS (translucent bars, tab bar) or
 * Android (Material 3 navigation bar). Read once at start-up and put on `<html data-platform>`,
 * where only CSS looks at it — no behaviour depends on the answer.
 *
 * It covers the native shells (a WKWebView and an Android WebView both report their OS) and the
 * PWA in a phone browser alike. iPadOS reports itself as a Mac, so a touch screen is what tells
 * the two apart.
 */
export type Platform = 'ios' | 'android' | 'other'

export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios'
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'ios'
  if (/Android/.test(userAgent)) return 'android'
  return 'other'
}
