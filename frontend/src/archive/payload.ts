/**
 * The portable archive is the app's own HTML with the dump v2 bytes embedded as base64 in one
 * script block (docs/architecture/storage/portable-archive.md). Pure string work, no DOM.
 */
export const PAYLOAD_ID = 'hearth-data'
export const PAYLOAD_TYPE = 'application/x-hearth-archive'
/** What the built template carries until a real payload is spliced in. */
export const PAYLOAD_PLACEHOLDER = 'HEARTH_ARCHIVE_PAYLOAD'

const OPEN = `<script type="${PAYLOAD_TYPE}" id="${PAYLOAD_ID}">`
const CLOSE = '</script>'

export function encodePayload(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const b64 = btoa(bin)
  // 76-column lines keep editors and diff tools sane on a 10 MB file.
  return b64.replace(/(.{76})/g, '$1\n')
}

export function decodePayload(text: string): Uint8Array {
  const bin = atob(text.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** The raw base64 inside the data block, or null if the HTML is not an archive (or is the template). */
export function extractPayload(html: string): string | null {
  const start = html.indexOf(OPEN)
  if (start < 0) return null
  const end = html.indexOf(CLOSE, start)
  if (end < 0) return null
  const body = html.slice(start + OPEN.length, end).trim()
  return body && body !== PAYLOAD_PLACEHOLDER ? body : null
}

/** Replaces whatever the data block holds (placeholder or an old payload) with `b64`. */
export function splicePayload(html: string, b64: string): string {
  const start = html.indexOf(OPEN)
  if (start < 0) throw new Error('not an archive template')
  const end = html.indexOf(CLOSE, start)
  if (end < 0) throw new Error('not an archive template')
  return `${html.slice(0, start + OPEN.length)}\n${b64}\n${html.slice(end)}`
}
