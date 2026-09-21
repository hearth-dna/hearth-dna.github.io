import { describe, expect, it } from 'vitest'
import { isSidecar, missingSidecars, shaOfSidecar, sidecarName } from './sidecar'

const sha = (c: string) => c.repeat(64)

describe('sidecarName', () => {
  it('round-trips', () => {
    expect(sidecarName(sha('a'))).toBe(`${sha('a')}.att`)
    expect(shaOfSidecar(sidecarName(sha('b')))).toBe(sha('b'))
  })

  it('recognises only its own files', () => {
    expect(isSidecar(sidecarName(sha('a')))).toBe(true)
    expect(isSidecar('hearth-backup.hearth')).toBe(false)
    expect(isSidecar('README.txt')).toBe(false)
    // A cloud client's conflicted copy must not be mistaken for a sidecar.
    expect(isSidecar(`${sha('a')} (1).att`)).toBe(false)
  })
})

describe('missingSidecars', () => {
  it('is the set difference', () => {
    expect(missingSidecars([sha('a'), sha('b')], [sidecarName(sha('a'))])).toEqual([sha('b')])
  })

  it('ignores files it did not write', () => {
    expect(missingSidecars([sha('a')], ['README.txt', 'hearth-backup.hearth'])).toEqual([sha('a')])
  })

  it('collapses duplicates and skips what is already there', () => {
    expect(missingSidecars([sha('a'), sha('a')], [])).toEqual([sha('a')])
    expect(missingSidecars([sha('a')], [sidecarName(sha('a'))])).toEqual([])
    expect(missingSidecars([], [sidecarName(sha('a'))])).toEqual([])
  })
})
