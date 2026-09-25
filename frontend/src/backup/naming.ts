import type { Header } from '../export/container'

/**
 * Pure naming and conflict rules for the backup folder (docs/architecture/storage/backup-folder.md).
 * Everything that touches a real directory handle lives in folder.ts.
 */
export const ROTATIONS = 3

/** `hearth-backup.hearth`, or `hearth-backup-<profile>.hearth` for a non-default profile. */
export function baseName(profile: string): string {
  return profile === 'default' ? 'hearth-backup.hearth' : `hearth-backup-${profile}.hearth`
}

export const rotatedName = (base: string, n: number) => `${base}.${n}`

/** Copies to make, oldest first, so that `base` can then be overwritten with the newest snapshot. */
export function rotationPlan(
  existing: string[],
  base: string,
  keep = ROTATIONS,
): { from: string; to: string }[] {
  const have = new Set(existing)
  const plan: { from: string; to: string }[] = []
  for (let n = keep - 1; n >= 1; n--) {
    const from = rotatedName(base, n)
    if (have.has(from)) plan.push({ from, to: rotatedName(base, n + 1) })
  }
  if (have.has(base)) plan.push({ from: base, to: rotatedName(base, 1) })
  return plan
}

/**
 * Older copies (`base.1`, `base.2`…) then conflict files of this profile, the order to try them in
 * when the current snapshot lacks a genome.
 */
export function spareNames(existing: string[], base: string): string[] {
  const conflict = base.replace(/\.hearth$/, '.conflict-')
  const rotated = existing
    .filter((n) => n.startsWith(`${base}.`) && /^\d+$/.test(n.slice(base.length + 1)))
    .sort((a, b) => Number(a.slice(base.length + 1)) - Number(b.slice(base.length + 1)))
  const conflicts = existing
    .filter((n) => n.startsWith(conflict))
    .sort()
    .reverse()
  return [...rotated, ...conflicts]
}

export function conflictName(base: string, device: string, at: string): string {
  return `${base.replace(/\.hearth$/, '')}.conflict-${device.slice(0, 8)}-${at.slice(0, 19).replace(/[:T]/g, '-')}.hearth`
}

/** The header of the snapshot this browser last wrote to or loaded from the folder. */
export interface Seen {
  device: string
  generation: number
}

/**
 * True when the folder holds a snapshot from another browser that this one has not loaded: a
 * second PC saved since we last looked, and overwriting would silently discard its work.
 */
export function isForeign(current: Header | null, ourDevice: string, lastSeen: Seen | null): boolean {
  if (!current || current.device === ourDevice) return false
  return !(lastSeen && lastSeen.device === current.device && lastSeen.generation === current.generation)
}

/** The folder file is newer than what this browser has loaded from it. */
export function hasNewer(current: Header | null, ourDevice: string, lastSeen: Seen | null): boolean {
  if (!current || current.device === ourDevice) return false
  return !lastSeen || lastSeen.device !== current.device || current.generation > lastSeen.generation
}

export const README = (url: string) =>
  [
    'This folder is written by Hearth, a local-first family genome browser.',
    '',
    'hearth-backup*.hearth files are snapshots of everything in the app (people, genome files, health',
    'log, notes). The newest is hearth-backup.hearth; .1, .2, ... are older copies. A file starting',
    'with "HRTH2" is encrypted with the passphrase set in Hearth; a file starting with "PK" is a',
    'plain zip and readable by anyone who has it.',
    '',
    `To restore: open ${url}, go to Settings, choose this folder, and press "Load from folder".`,
    '',
  ].join('\n')
