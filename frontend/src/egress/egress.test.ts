import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sendContext } from './egress'

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
    await expect(sendContext({ kind: 'helper' }, '# ctx', 'q', { confirmedAt: '' })).rejects.toThrow(
      /confirmation/,
    )
  })
})
