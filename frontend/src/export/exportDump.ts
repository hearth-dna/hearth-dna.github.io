import type { Database } from '../db/db'
import { snapshotBytes } from './snapshot'

/** Hands bytes to the browser as a download. The only way a file leaves the app without a folder. */
export function downloadBytes(bytes: Uint8Array, name: string, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

export const dumpFileName = (passphrase?: string) =>
  `hearth-dump-${new Date().toISOString().slice(0, 10)}.hearth${passphrase ? '.enc' : ''}`

/**
 * Builds the full dump (v2 container) and hands it to the browser as a download. Shared by
 * Settings and the erase dialog, so "export before you erase" is the same file as a normal backup.
 */
export async function exportDumpFile(db: Database, appVersion: string, passphrase?: string): Promise<string> {
  const bytes = await snapshotBytes(db, appVersion, passphrase)
  const name = dumpFileName(passphrase)
  downloadBytes(bytes, name)
  return `Exported ${name} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)${passphrase ? ', encrypted' : ' — plaintext genetic data, keep it safe'}`
}
