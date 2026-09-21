/**
 * Naming and the diff for the copies of attached documents that live beside the snapshot in the
 * backup folder (docs/architecture/storage/backup-folder.md).
 *
 * Sidecars are content-addressed and written once. Two computers writing the same name write the
 * same bytes, so unlike the snapshot they can never conflict, and nothing needs rotating.
 */
export const SIDECAR_EXT = '.att'

export const sidecarName = (sha256: string) => `${sha256}${SIDECAR_EXT}`
export const isSidecar = (name: string) => /^[0-9a-f]{64}\.att$/.test(name)
export const shaOfSidecar = (name: string) => name.slice(0, 64)

/**
 * Which sidecars this run still has to write. Recomputed from the folder every time rather than
 * remembered, so a reformatted stick, a cloud folder that dropped a file, or documents attached
 * while the folder was unreachable all heal on the next backup.
 */
export function missingSidecars(wantedShas: string[], presentNames: string[]): string[] {
  const have = new Set(presentNames.filter(isSidecar).map(shaOfSidecar))
  const out: string[] = []
  for (const sha of new Set(wantedShas)) if (!have.has(sha)) out.push(sha)
  return out
}
