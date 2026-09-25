import { type Container, fillGenomes, missingGenomes, openContainer } from '../export/container'
import type { Progress } from '../export/restore'

/**
 * Opens a folder snapshot and, if it lost genome files (an interrupted sync, a bad copy), fills
 * them from the spares next to it: older copies, then conflict files (`naming.spareNames`). Paths
 * are content hashes and every entry is verified on open, so a match is the same file.
 */
export async function openRepaired(
  bytes: Uint8Array,
  passphrase: string | undefined,
  spares: string[],
  read: (name: string) => Promise<Uint8Array | null>,
  onProgress: Progress = () => {},
): Promise<Container> {
  onProgress('restore.openingDump')
  const c = await openContainer(bytes, passphrase)
  if (!missingGenomes(c).length) return c
  onProgress('restore.repairing')
  for (const name of spares) {
    try {
      const spare = await read(name)
      if (spare) fillGenomes(c, await openContainer(spare, passphrase))
    } catch {
      // Another passphrase or an unreadable file: it just cannot help.
    }
    if (!missingGenomes(c).length) break
  }
  return c
}
