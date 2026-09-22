import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cloudRequest, readDocumentWithGemini, sendContext } from './egress'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('egress gateway', () => {
  it('is the only application module that calls fetch or XMLHttpRequest', () => {
    const src = join(__dirname, '..')
    const offenders = walk(src).filter((f) => {
      if (f.endsWith('egress/egress.ts')) return false
      const code = readFileSync(f, 'utf8')
      return (
        /\bfetch\s*\(/.test(code) ||
        /XMLHttpRequest/.test(code) ||
        /navigator\.sendBeacon/.test(code) ||
        /new WebSocket/.test(code)
      )
    })
    expect(offenders).toEqual([])
  })

  it('refuses to send personal data without a confirmation token', async () => {
    await expect(sendContext({ byokKey: 'k' }, '# ctx', 'q', { confirmedAt: '' })).rejects.toThrow(
      /confirmation/,
    )
    await expect(readDocumentWithGemini({ byokKey: 'k' }, [], 'p', {}, { confirmedAt: '' })).rejects.toThrow(
      /confirmation/,
    )
  })
  it('refuses a direct provider call without a key', async () => {
    await expect(
      readDocumentWithGemini({ byokKey: '' }, [], 'p', {}, { confirmedAt: 'now' }),
    ).rejects.toThrow(/API key/)
  })

  it('sends cloud backups only to the provider hosts', async () => {
    const sealed = new TextEncoder().encode('HRTH2\u0000\u0010sealed')
    const base = { provider: 'google' as const, token: 't', method: 'PUT' as const }
    await expect(cloudRequest({ ...base, url: 'https://evil.example/upload', body: sealed })).rejects.toThrow(
      /refusing to contact/,
    )
    await expect(
      cloudRequest({ ...base, provider: 'dropbox', url: 'https://www.googleapis.com/drive/v3/files' }),
    ).rejects.toThrow(/refusing to contact/)
    await expect(cloudRequest({ ...base, url: 'http://www.googleapis.com/upload' })).rejects.toThrow(
      /refusing to contact/,
    )
    await expect(
      cloudRequest({ ...base, token: '', url: 'https://www.googleapis.com/drive/v3/files' }),
    ).rejects.toThrow(/signed in/)
  })
})
