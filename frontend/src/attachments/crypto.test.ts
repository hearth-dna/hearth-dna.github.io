import { describe, expect, it, vi } from 'vitest'
import { isEncrypted, opener, sealer } from './crypto'

const plain = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 251))

describe('sealer / opener', () => {
  it('round-trips a document', async () => {
    const seal = await sealer('correct horse')
    const open = await opener('correct horse')
    const sealed = await seal(plain(2048))
    expect(isEncrypted(sealed)).toBe(true)
    expect(await open(sealed)).toEqual(plain(2048))
  })

  it('gives each file its own nonce', async () => {
    const seal = await sealer('pass')
    const a = await seal(plain(32))
    const b = await seal(plain(32))
    expect(a).not.toEqual(b)
  })

  it('rejects a wrong passphrase and tampered bytes', async () => {
    const sealed = await (await sealer('right'))(plain(64))
    await expect((await opener('wrong'))(sealed)).rejects.toThrow()
    const tampered = new Uint8Array(sealed)
    tampered[tampered.length - 1] ^= 0xff
    await expect((await opener('right'))(tampered)).rejects.toThrow()
  })

  it('refuses bytes that are not an envelope', async () => {
    await expect((await opener('pass'))(plain(64))).rejects.toThrow(/not an encrypted attachment/)
  })

  it('derives the key once per run, not once per file', async () => {
    // 600k PBKDF2 iterations per document would block the tab for a minute on every backup.
    const spy = vi.spyOn(crypto.subtle, 'deriveKey')
    const seal = await sealer('pass')
    for (let i = 0; i < 5; i++) await seal(plain(16))
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('opens a run of sidecars with one derivation, and pays once more for a foreign one', async () => {
    const mine = await sealer('pass')
    const theirs = await sealer('pass')
    const files = [await mine(plain(16)), await mine(plain(16)), await theirs(plain(16))]
    const spy = vi.spyOn(crypto.subtle, 'deriveKey')
    const open = await opener('pass')
    for (const f of files) await open(f)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})
