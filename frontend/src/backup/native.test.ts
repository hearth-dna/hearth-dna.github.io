import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { open, writeSnapshot } from './folder'
import { fromBase64, toBase64 } from './native'

/**
 * The shells' side of the channel, in memory: the same ops and replies as Files.kt and
 * NativeFiles.swift, so the page's half of the protocol is exercised without a phone. Chunks are
 * tiny here so every transfer takes several round trips.
 */
function fakeShell() {
  const files = new Map<string, Uint8Array>()
  const dirs = new Set<string>(['R'])
  const sessions = new Map<string, { key: string; parts: Uint8Array[]; at: number }>()
  let next = 0
  const key = (a: { ref: string; path: string[]; name: string | null }) =>
    [a.ref, ...a.path, ...(a.name === null ? [] : [a.name])].join('/')

  // biome-ignore lint/suspicious/noExplicitAny: a request is whatever the page sent
  const ops: Record<string, (a: any) => unknown> = {
    list: (a) => {
      const prefix = `${[a.ref, ...a.path].join('/')}/`
      return [...files.keys(), ...dirs]
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map((k) => k.slice(prefix.length))
    },
    mkdir: (a) => {
      const k = key(a)
      if (a.create) dirs.add(k)
      return dirs.has(k)
    },
    remove: (a) => files.delete(key(a)) || dirs.delete(key(a)),
    open: (a) => {
      const bytes = files.get(key(a))
      if (!bytes) return null
      const id = String(++next)
      const parts: Uint8Array[] = []
      for (let i = 0; i < bytes.length; i += 3) parts.push(bytes.subarray(i, i + 3))
      sessions.set(id, { key: key(a), parts, at: 0 })
      return id
    },
    chunk: (a) => {
      const s = sessions.get(a.handle)
      if (!s) throw new Error('no such read')
      const part = s.parts[s.at++]
      if (!part) sessions.delete(a.handle)
      return part ? toBase64(part) : ''
    },
    create: (a) => {
      const id = String(++next)
      sessions.set(id, { key: key(a), parts: [], at: 0 })
      return id
    },
    append: (a) => {
      sessions.get(a.handle)?.parts.push(fromBase64(a.data))
      return null
    },
    close: (a) => {
      const s = sessions.get(a.handle)
      sessions.delete(a.handle)
      if (s && a.ok) {
        const out = new Uint8Array(s.parts.reduce((n, p) => n + p.length, 0))
        let at = 0
        for (const p of s.parts) {
          out.set(p, at)
          at += p.length
        }
        files.set(s.key, out)
      }
      return null
    },
  }

  const channel = {
    onmessage: null as ((e: { data: string }) => void) | null,
    postMessage(message: string) {
      const { id, op, ...args } = JSON.parse(message)
      queueMicrotask(() => {
        let reply: object
        try {
          reply = { id, ok: true, value: ops[op](args) }
        } catch (e) {
          reply = { id, ok: false, error: (e as Error).message }
        }
        channel.onmessage?.({ data: JSON.stringify(reply) })
      })
    },
  }
  return { files, channel }
}

const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)
const bytes = (s: string) => new TextEncoder().encode(s)

describe('native backup places', () => {
  let shell: ReturnType<typeof fakeShell>
  beforeEach(() => {
    shell = fakeShell()
    ;(globalThis as { window?: unknown }).window = { HearthFiles: shell.channel }
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('round-trips base64 across slice boundaries', () => {
    const big = new Uint8Array(0x8000 * 2 + 5).map((_, i) => i % 256)
    expect(fromBase64(toBase64(big))).toEqual(big)
  })

  it('rotates snapshots and reads them back through a picked folder', async () => {
    const dir = open({ kind: 'native', ref: 'R', name: 'Drive', single: false }, 'hearth-backup.hearth')
    await writeSnapshot(dir, 'hearth-backup.hearth', bytes('first snapshot'), 'https://hearth.example')
    await writeSnapshot(dir, 'hearth-backup.hearth', bytes('second snapshot'), 'https://hearth.example')
    expect(text(await dir.read('hearth-backup.hearth'))).toBe('second snapshot')
    expect(text(await dir.read('hearth-backup.hearth.1'))).toBe('first snapshot')
    expect(await dir.read('missing')).toBeNull()
    expect((await dir.names()).sort()).toEqual([
      'README.txt',
      'hearth-backup.hearth',
      'hearth-backup.hearth.1',
    ])
  })

  it('reaches subfolders by path', async () => {
    const dir = open({ kind: 'native', ref: 'R', name: 'Drive', single: false }, 'hearth-backup.hearth')
    expect(await dir.subdir('attachments')).toBeNull()
    const sub = await dir.subdir('attachments', true)
    await sub?.write('abc.att', bytes('doc'))
    expect(text(shell.files.get('R/attachments/abc.att') ?? null)).toBe('doc')
    expect(await sub?.names()).toEqual(['abc.att'])
  })

  it('treats a picked file as the snapshot and nothing else', async () => {
    const dir = open(
      { kind: 'native', ref: 'F', name: 'hearth-backup.hearth', single: true },
      'hearth-backup.hearth',
    )
    await writeSnapshot(dir, 'hearth-backup.hearth', bytes('one'), 'https://hearth.example')
    await writeSnapshot(dir, 'hearth-backup.hearth', bytes('two'), 'https://hearth.example')
    expect([...shell.files.keys()]).toEqual(['F'])
    expect(text(await dir.read('hearth-backup.hearth'))).toBe('two')
    await expect(dir.write('README.txt', 'x')).rejects.toThrow(/single file/)
    expect(await dir.subdir('attachments', true)).toBeNull()
  })

  it('surfaces a failure from the shell as an error', async () => {
    const dir = open({ kind: 'native', ref: 'R', name: 'Drive', single: false }, 'hearth-backup.hearth')
    const channel = shell.channel
    channel.postMessage = (message: string) => {
      const { id } = JSON.parse(message)
      queueMicrotask(() =>
        channel.onmessage?.({ data: JSON.stringify({ id, ok: false, error: 'provider offline' }) }),
      )
    }
    await expect(dir.write('x', bytes('y'))).rejects.toThrow('provider offline')
  })
})
