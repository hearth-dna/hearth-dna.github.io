import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderError, readDocumentWithGemini, sendContext } from './egress'

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
})

describe('provider errors', () => {
  const call = (onRetry?: (n: number) => void) =>
    readDocumentWithGemini({ byokKey: 'k' }, [], 'p', {}, { confirmedAt: 'now' }, { delays: [0, 0], onRetry })
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const ok = reply(200, { modelVersion: 'm', candidates: [{ content: { parts: [{ text: '{}' }] } }] })
  afterEach(() => vi.unstubAllGlobals())

  it('retries an overloaded provider and succeeds', async () => {
    const replies = [reply(503, { error: { message: 'The model is overloaded.' } }), ok]
    const fetch = vi.fn(async () => replies.shift() as Response)
    vi.stubGlobal('fetch', fetch)
    const retries: number[] = []
    await expect(call((n) => retries.push(n))).resolves.toEqual({ text: '{}', model: 'm' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(retries).toEqual([2])
  })

  it('gives up after two retries with the status and the provider message', async () => {
    vi.stubGlobal('fetch', async () => reply(503, { error: { message: 'The model is overloaded.' } }))
    const e = await call().catch((x) => x)
    expect(e).toBeInstanceOf(ProviderError)
    expect(e).toMatchObject({ status: 503, detail: 'The model is overloaded.', retryable: true })
  })

  it('does not retry a bad key, and treats a dropped connection as retryable', async () => {
    const fetch = vi.fn(async () => reply(403, { error: { message: 'API key not valid.' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(call()).rejects.toMatchObject({ status: 403, retryable: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', offline)
    await expect(call()).rejects.toMatchObject({ status: 0, retryable: true })
    expect(offline).toHaveBeenCalledTimes(3)
  })
})
