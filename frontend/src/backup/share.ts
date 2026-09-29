import { downloadBytes } from '../export/exportDump'

/**
 * The backup route for browsers without a folder picker (phones, Safari, Firefox): hand the
 * snapshot to the system share sheet, where the user picks Google Drive, Files or any other app.
 * Where files cannot be shared (Chrome on Android shares only an allowlist of media types) the
 * snapshot is downloaded instead. Nothing here touches the network.
 */

const asFile = (bytes: Uint8Array, name: string) =>
  new File([bytes as BlobPart], name, { type: 'application/octet-stream' })

export function canShareFiles(): boolean {
  try {
    return navigator.canShare?.({ files: [asFile(new Uint8Array(), 'hearth-backup.hearth')] }) ?? false
  } catch {
    return false
  }
}

/**
 * Throws `AbortError` when the user closes the sheet, and `NotAllowedError` when the click that
 * started this has expired (building a large snapshot can outlast it); the caller asks again.
 */
export async function shareOrDownload(bytes: Uint8Array, name: string): Promise<'shared' | 'downloaded'> {
  const file = asFile(bytes, name)
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name })
    return 'shared'
  }
  downloadBytes(bytes, name)
  return 'downloaded'
}
