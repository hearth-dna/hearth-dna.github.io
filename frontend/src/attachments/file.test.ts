import { describe, expect, it } from 'vitest'
import {
  attachmentBlobName,
  checkFile,
  isAttachmentBlob,
  isThumbnailable,
  MAX_FILE_BYTES,
  MAX_PER_ENTRY,
  safeDisplayName,
  sniffMime,
} from './file'

const bytes = (...parts: (number | string)[]) => {
  const out: number[] = []
  for (const p of parts)
    if (typeof p === 'number') out.push(p)
    else for (const c of p) out.push(c.charCodeAt(0))
  return new Uint8Array([...out, ...Array(16).fill(0)])
}

describe('sniffMime', () => {
  it('recognises the formats we accept', () => {
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffMime(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffMime(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('image/webp')
    expect(sniffMime(bytes('%PDF-1.7'))).toBe('application/pdf')
    expect(sniffMime(bytes(0, 0, 0, 0x18, 'ftypheic'))).toBe('image/heic')
    expect(sniffMime(bytes(0, 0, 0, 0x18, 'ftypmif1'))).toBe('image/heif')
  })

  it('rejects anything else, however it is named', () => {
    expect(sniffMime(bytes('MZ', 0x90, 0))).toBeNull() // a renamed .exe
    expect(sniffMime(bytes('<!DOCTYPE html>'))).toBeNull()
    expect(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull() // zip
  })

  it('does not read past the end of a truncated file', () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(sniffMime(new Uint8Array())).toBeNull()
  })
})

describe('safeDisplayName', () => {
  it('keeps a normal name', () => {
    expect(safeDisplayName('blood-count 2026.pdf')).toBe('blood-count 2026.pdf')
  })

  it('strips separators and control characters', () => {
    expect(safeDisplayName('../../etc/passwd')).toBe('.. .. etc passwd')
    expect(safeDisplayName('scan\u0000\u001f.pdf')).toBe('scan .pdf')
  })

  it('caps the length and never returns empty', () => {
    expect(safeDisplayName('a'.repeat(300))).toHaveLength(120)
    expect(safeDisplayName('   ')).toBe('document')
    expect(safeDisplayName('')).toBe('document')
  })

  it('leaves non-latin names alone', () => {
    expect(safeDisplayName('анализ крови.pdf')).toBe('анализ крови.pdf')
  })
})

describe('attachmentBlobName', () => {
  const sha = 'a'.repeat(64)

  it('passes the worker name guard', () => {
    // Mirrors safeName in db/db.worker.ts; a name it rejects would fail only at write time.
    expect(attachmentBlobName(sha)).toMatch(/^[a-z0-9._-]{1,120}$/i)
  })

  it('round-trips through the recogniser', () => {
    expect(isAttachmentBlob(attachmentBlobName(sha))).toBe(true)
    expect(isAttachmentBlob(`genome-${sha}.gz`)).toBe(false)
    expect(isAttachmentBlob('att-nothex.bin')).toBe(false)
  })
})

describe('checkFile', () => {
  it('accepts a sniffed file inside the limits', () => {
    expect(checkFile({ size: 1000 }, 'application/pdf', 0)).toBeNull()
  })

  it('names each reason', () => {
    expect(checkFile({ size: 1000 }, null, 0)).toBe('type')
    expect(checkFile({ size: MAX_FILE_BYTES + 1 }, 'image/png', 0)).toBe('size')
    expect(checkFile({ size: 0 }, 'image/png', 0)).toBe('size')
    expect(checkFile({ size: 10 }, 'image/png', MAX_PER_ENTRY)).toBe('count')
  })
})

describe('isThumbnailable', () => {
  it('excludes the formats browsers will not decode', () => {
    expect(isThumbnailable('image/png')).toBe(true)
    expect(isThumbnailable('image/heic')).toBe(false)
    expect(isThumbnailable('application/pdf')).toBe(false)
  })
})
