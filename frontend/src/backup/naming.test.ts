import { describe, expect, it } from 'vitest'
import type { Header } from '../export/container'
import {
  attachmentsDirName,
  baseName,
  hasNewer,
  phoneCopyName,
  rotationPlan,
  sharedAction,
  sharedName,
  sharedToLoad,
  spareNames,
} from './naming'

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

  it('finds the snapshots a phone shared into the folder, oldest first, once', () => {
    const names = [
      'hearth-backup.hearth',
      'hearth-backup.hearth.1',
      'hearth-backup-2026-10-02-0915.hearth',
      'hearth-backup-2026-09-29-1402.hearth',
      'hearth-backup-2026-09-29-1402 (1).hearth',
      'hearth-backup-2026-09-29-1402 2.hearth',
      'hearth-backup-kids-2026-09-30-0800.hearth',
      'hearth-phone-copy.hearth',
      'genomes',
      'README.txt',
    ]
    expect(sharedToLoad(names, 'default', ['hearth-backup-2026-10-02-0915.hearth'])).toEqual([
      'hearth-backup-2026-09-29-1402 (1).hearth',
      'hearth-backup-2026-09-29-1402 2.hearth',
      'hearth-backup-2026-09-29-1402.hearth',
    ])
    expect(sharedToLoad(names, 'kids', [])).toEqual(['hearth-backup-kids-2026-09-30-0800.hearth'])
  })

  it('leaves a shared snapshot it cannot open for later, and passes over what is not a backup', () => {
    const plain = { ...header('phone', 3), encrypted: false }
    expect(sharedAction(header('phone', 3), true, false)).toBe('later')
    expect(sharedAction(header('phone', 3), true, true)).toBe('load')
    expect(sharedAction(plain, true, false)).toBe('load')
    expect(sharedAction(null, true, false)).toBe('load')
    expect(sharedAction(null, false, true)).toBe('ignore')
  })

  it('stamps shared snapshots with the local time', () => {
    const at = new Date(2026, 8, 29, 14, 2)
    expect(sharedName('default', at)).toBe('hearth-backup-2026-09-29-1402.hearth')
    expect(sharedName('kids', at)).toBe('hearth-backup-kids-2026-09-29-1402.hearth')
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

  it('lists older copies oldest-last, then conflict files newest-first', () => {
    const base = 'hearth-backup.hearth'
    expect(
      spareNames(
        [
          base,
          `${base}.3`,
          `${base}.1`,
          'README.txt',
          'hearth-backup.conflict-aa-2026-09-01-10-00-00.hearth',
          'hearth-backup.conflict-bb-2026-09-20-10-00-00.hearth',
          'hearth-backup-kids.hearth.1',
          `${base}.1.tmp`,
        ],
        base,
      ),
    ).toEqual([
      `${base}.1`,
      `${base}.3`,
      'hearth-backup.conflict-bb-2026-09-20-10-00-00.hearth',
      'hearth-backup.conflict-aa-2026-09-01-10-00-00.hearth',
    ])
  })

  it('offers a load when the folder is ahead of what we loaded', () => {
    expect(hasNewer(header('B', 5), 'A', null)).toBe(true)
    expect(hasNewer(header('B', 5), 'A', { device: 'B', generation: 5 })).toBe(false)
    expect(hasNewer(header('B', 7), 'A', { device: 'B', generation: 5 })).toBe(true)
    expect(hasNewer(header('A', 7), 'A', null)).toBe(false)
  })
})

describe('attachmentsDirName', () => {
  it('is shared by default and separate per profile', () => {
    expect(attachmentsDirName('default')).toBe('attachments')
    expect(attachmentsDirName('mum')).toBe('attachments-mum')
  })
})

describe('the single-file copy for a phone', () => {
  it('is never taken for a snapshot, a rotation or a spare', () => {
    const names = [phoneCopyName('default'), phoneCopyName('family-b'), 'hearth-backup.hearth.1']
    expect(spareNames(names, baseName('default'))).toEqual(['hearth-backup.hearth.1'])
    expect(spareNames(names, baseName('family-b'))).toEqual([])
    expect(rotationPlan(names, baseName('default')).map((x) => x.from)).not.toContain(
      phoneCopyName('default'),
    )
  })
})
