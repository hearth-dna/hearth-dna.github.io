import type { Header } from '../export/container'

/**
 * Pure naming and newer-copy rules for the backup folder (docs/architecture/storage/backup-folder.md).
 * Everything that touches a real directory handle lives in folder.ts.
 */
export const ROTATIONS = 3

/** `hearth-backup.hearth`, or `hearth-backup-<profile>.hearth` for a non-default profile. */
export function baseName(profile: string): string {
  return profile === 'default' ? 'hearth-backup.hearth' : `hearth-backup-${profile}.hearth`
}

/**
 * The backup file every device of a family reads and writes, phones included: `baseName` unless
 * the user named it (Settings). A name without `.hearth` gets it; a path is not a name.
 */
export function fileName(profile: string, chosen?: string): string {
  const n = chosen?.trim() ?? ''
  if (!n || /[/\\]/.test(n)) return baseName(profile)
  return n.endsWith('.hearth') ? n : `${n}.hearth`
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Backups beside `base` that another device saved instead of replacing it: the " (1)" or " 2" a
 * drive or Files adds when the name is taken, and the names earlier versions gave a phone's copy
 * (`hearth-phone.hearth`, `hearth-backup-2026-09-29-1402.hearth`). Never `base` itself, its
 * rotations, or the phone copy. Sorted by name.
 */
export function sharedFiles(existing: string[], base: string, profile: string): string[] {
  const stem = (n: string) => literal(n.replace(/\.hearth$/, ''))
  const copy = new RegExp(`^${stem(base)}( \\(\\d+\\)| ?\\d+)\\.hearth$`)
  const legacy = '( ?\\(?\\d+\\)?)?\\.hearth$'
  const phone = new RegExp(
    `^${profile === 'default' ? 'hearth-phone' : stem(`hearth-phone-${profile}.hearth`)}${legacy}`,
  )
  const stamped = new RegExp(`^${stem(baseName(profile))}-\\d{4}-\\d{2}-\\d{2}-\\d{4}${legacy}`)
  return existing.filter((n) => n !== base && [copy, phone, stamped].some((r) => r.test(n))).sort()
}

/**
 * What a computer remembers of a shared snapshot it has loaded: the name and the header's device
 * and generation, so a newer one saved under the same name is loaded again.
 */
export const sharedKey = (name: string, header: Header | null) =>
  header ? `${name}|${header.device}|${header.generation}` : name

/**
 * What a sync does with a shared snapshot: load it, leave it for when the passphrase is entered, or
 * pass over it for good (not a Hearth backup). Never a reason to stop the folder's own backups.
 */
export function sharedAction(
  header: Header | null,
  isBackup: boolean,
  hasPassphrase: boolean,
): 'load' | 'later' | 'ignore' {
  if (!isBackup) return 'ignore'
  return header?.encrypted && !hasPassphrase ? 'later' : 'load'
}

export const rotatedName = (base: string, n: number) => `${base}.${n}`

/**
 * Where the copies of attached documents go. Per profile, so two families sharing one stick never
 * delete each other's documents when one of them forgets the folder.
 */
export const attachmentsDirName = (profile: string) =>
  profile === 'default' ? 'attachments' : `attachments-${profile}`

/**
 * A single-file copy for a phone, kept beside the snapshot: the folder snapshot keeps genomes in a
 * subfolder, and a phone's file picker selects within one folder only. Not a name the snapshot
 * rules (rotation, spares, conflicts) ever match.
 */
export const phoneCopyName = (profile: string) =>
  profile === 'default' ? 'hearth-phone-copy.hearth' : `hearth-phone-copy-${profile}.hearth`

/** Quiet time after a backup before the phone copy follows it, and the most it may lag behind. */
export const PHONE_COPY_QUIET_MS = 60_000
export const PHONE_COPY_MAX_MS = 10 * 60_000

/**
 * How long to wait before rewriting the phone copy, or null when it already holds `generation`.
 * The copy is the whole family, so a burst of edits writes it once, and never later than the cap.
 */
export function phoneCopyDelay(
  generation: number,
  written: number | undefined,
  behindSince: number,
  now: number,
): number | null {
  if (written !== undefined && written >= generation) return null
  return Math.max(0, Math.min(PHONE_COPY_QUIET_MS, behindSince + PHONE_COPY_MAX_MS - now))
}

/** Where a folder snapshot's genome files go (`external_genomes`), per profile like attachments. */
export const genomesDirName = (profile: string) => (profile === 'default' ? 'genomes' : `genomes-${profile}`)

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

/** The header of the snapshot this browser last wrote to or loaded from the folder. */
export interface Seen {
  device: string
  generation: number
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
    'log, notes). The newest is hearth-backup.hearth (or the name set in Settings, the same on every',
    'device); .1, .2, ... are older copies. hearth-phone-copy.hearth has the DNA inside, for a phone.',
    'Phones save their backup over the same file, or beside it as a copy. A file starting',
    'with "HRTH2" is encrypted with the passphrase set in Hearth; a file starting with "PK" is a',
    'plain zip and readable by anyone who has it.',
    '',
    'The attachments folder holds one file per image or PDF attached to a health log entry, named',
    'after the content of the file. Files starting with "HRTH1" are encrypted with the same',
    'passphrase. They are written once and kept even after an entry is deleted, because the older',
    'snapshots above may still refer to them; removing one only loses that document.',
    '',
    `To restore: open ${url}, go to Settings, choose this folder, and press "Load from folder".`,
    '',
  ].join('\n')
