import { describe, expect, it } from 'vitest'
import type { Header } from '../export/container'
import { baseName, conflictName, hasNewer, isForeign, rotationPlan } from './naming'

const header = (device: string, generation: number): Header => ({
  format: 'hearth-dump',
  version: 2,
  generation,
  device,
  exported_at: '2026-09-14T10:00:00Z',
  encrypted: true,
})

describe('backup naming', () => {
  it('names the file per profile', () => {
    expect(baseName('default')).toBe('hearth-backup.hearth')
    expect(baseName('kids')).toBe('hearth-backup-kids.hearth')
  })

  it('plans rotation oldest first and never beyond the keep count', () => {
    const base = 'hearth-backup.hearth'
    expect(rotationPlan([], base)).toEqual([])
    expect(rotationPlan([base], base)).toEqual([{ from: base, to: `${base}.1` }])
    expect(rotationPlan([base, `${base}.1`, `${base}.2`, `${base}.3`], base, 3)).toEqual([
      { from: `${base}.2`, to: `${base}.3` },
      { from: `${base}.1`, to: `${base}.2` },
      { from: base, to: `${base}.1` },
    ])
  })

  it('builds a conflict name without colons', () => {
    expect(conflictName('hearth-backup.hearth', 'abcdef01-2345', '2026-09-14T10:00:00.000Z')).toBe(
      'hearth-backup.conflict-abcdef01-2026-09-14-10-00-00.hearth',
    )
  })

  it('detects another device having written since we last looked', () => {
    expect(isForeign(null, 'A', null)).toBe(false)
    expect(isForeign(header('A', 9), 'A', null)).toBe(false)
    expect(isForeign(header('B', 5), 'A', null)).toBe(true)
    expect(isForeign(header('B', 5), 'A', { device: 'B', generation: 5 })).toBe(false)
    expect(isForeign(header('B', 6), 'A', { device: 'B', generation: 5 })).toBe(true)
  })

  it('offers a load when the folder is ahead of what we loaded', () => {
    expect(hasNewer(header('B', 5), 'A', null)).toBe(true)
    expect(hasNewer(header('B', 5), 'A', { device: 'B', generation: 5 })).toBe(false)
    expect(hasNewer(header('B', 7), 'A', { device: 'B', generation: 5 })).toBe(true)
    expect(hasNewer(header('A', 7), 'A', null)).toBe(false)
  })
})
