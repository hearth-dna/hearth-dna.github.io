import { gunzipSync, unzipSync } from 'fflate'

/**
 * Turns an uploaded File into text. Handles .zip (first text-like entry), .gz, and plain text. All
 * in the browser — nothing is uploaded anywhere.
 */
export async function fileToText(file: File): Promise<{ text: string; innerName: string }> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const name = file.name.toLowerCase()
  const isZip = name.endsWith('.zip') || (buf[0] === 0x50 && buf[1] === 0x4b)
  const isGz = name.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b)
  if (isZip) {
    const entries = unzipSync(buf)
    const candidates = Object.keys(entries).filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX'))
    const pick = candidates.sort((a, b) => entries[b].length - entries[a].length)[0]
    if (!pick) throw new Error('zip archive contains no files')
    return { text: new TextDecoder().decode(entries[pick]), innerName: pick }
  }
  if (isGz) {
    return { text: new TextDecoder().decode(gunzipSync(buf)), innerName: file.name.replace(/\.gz$/i, '') }
  }
  return { text: new TextDecoder().decode(buf), innerName: file.name }
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
