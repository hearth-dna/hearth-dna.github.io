/**
 * What may be attached to a health log entry, and what the bytes are called once stored. All pure:
 * the store, the picker and the mirror share these rules (docs/design.md §6.4).
 */

/** Offered in the file picker. The same set the document reader accepts. */
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'

/** Per file. A phone photo of a lab sheet is ~5 MB; a scanned multi-page PDF rarely passes this. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_PER_ENTRY = 12

const MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const
export type AttachmentMime = (typeof MIMES)[number]

const starts = (b: Uint8Array, bytes: number[], at = 0) => bytes.every((x, i) => b[at + i] === x)
const ascii = (b: Uint8Array, s: string, at = 0) =>
  starts(
    b,
    Array.from(s, (c) => c.charCodeAt(0)),
    at,
  )

/**
 * The type the bytes actually are, or null. `File.type` comes from the operating system's guess at
 * the extension, so it is a hint, never a decision: a renamed executable must not become an
 * "image/png" the app then hands to a blob URL.
 */
export function sniffMime(b: Uint8Array): AttachmentMime | null {
  if (b.length < 12) return null
  if (starts(b, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (ascii(b, 'RIFF') && ascii(b, 'WEBP', 8)) return 'image/webp'
  if (ascii(b, '%PDF-')) return 'application/pdf'
  if (ascii(b, 'ftyp', 4)) {
    // The brand sits at offset 8 of the ISO-BMFF box; HEIF images share the container with video.
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc') return 'image/heic'
    if (brand === 'mif1' || brand === 'msf1' || brand === 'heim') return 'image/heif'
  }
  return null
}

/** Whether the browser will decode this in an `<img>`; HEIC/HEIF will not outside Safari. */
export const isThumbnailable = (mime: string) =>
  mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp'

/**
 * A file name fit to show. It is stored in the database and rendered, never used to build a path,
 * so this only has to be harmless to display and to hand to a download attribute.
 */
export function safeDisplayName(raw: string): string {
  const name = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return name || 'document'
}

/** Where the bytes are cached next to the database. Content-addressed, so identical files share one. */
export const attachmentBlobName = (sha256OfBytes: string) => `att-${sha256OfBytes}.bin`
export const isAttachmentBlob = (name: string) => /^att-[0-9a-f]{64}\.bin$/.test(name)

export type Rejection = 'type' | 'size' | 'count' | 'space'

/** Why this file cannot be attached, or null when it can. `sniffed` is `sniffMime` of its bytes. */
export function checkFile(
  file: { size: number },
  sniffed: AttachmentMime | null,
  already: number,
): Rejection | null {
  if (!sniffed) return 'type'
  if (file.size > MAX_FILE_BYTES || file.size === 0) return 'size'
  if (already >= MAX_PER_ENTRY) return 'count'
  return null
}
