import { Database } from '../db/db'
import { fetchOwnAsset } from '../egress/egress'
import { downloadBytes } from '../export/exportDump'
import { snapshotBytes } from '../export/snapshot'
import {
  decodePayload,
  encodePayload,
  extractPayload,
  PAYLOAD_ID,
  PAYLOAD_TYPE,
  splicePayload,
} from './payload'

/**
 * Archive mode: the page was opened from a self-contained hearth-<date>.html. The database is
 * memory only, the data comes from the embedded payload, and "Save archive" writes a new file.
 * docs/architecture/storage/portable-archive.md
 */

/** Captured before React touches the DOM so a saved archive is the clean template plus data. */
const pristine =
  typeof document !== 'undefined' ? `<!doctype html>\n${document.documentElement.outerHTML}` : ''

let payload: Uint8Array | null | undefined

/** The embedded dump bytes, decoded once (a family's payload is megabytes); null when hosted. */
export function archivePayload(): Uint8Array | null {
  if (payload !== undefined) return payload
  const el = typeof document === 'undefined' ? null : document.getElementById(PAYLOAD_ID)
  const b64 = el
    ? extractPayload(`<script type="${PAYLOAD_TYPE}" id="${PAYLOAD_ID}">${el.textContent}</script>`)
    : null
  payload = b64 ? decodePayload(b64) : null
  return payload
}

export const isArchive = () => archivePayload() !== null

/** Memory-only database with the worker and wasm that the archive build inlined. */
export async function openArchiveDb(): Promise<Database> {
  if (!__HEARTH_ARCHIVE__) throw new Error('archive mode is only available in the archive build')
  const { makeWorker, wasmUrl } = await import('./worker')
  return Database.open({ memory: true, worker: makeWorker, wasmUrl })
}

export const archiveFileName = (passphrase?: string) =>
  `hearth-${new Date().toISOString().slice(0, 10)}${passphrase ? '' : '-plaintext'}.html`

/** In archive mode: this page's own HTML with the current data spliced in. */
export async function saveArchive(db: Database, appVersion: string, passphrase?: string): Promise<string> {
  const bytes = await snapshotBytes(db, appVersion, passphrase)
  const html = splicePayload(pristine, encodePayload(bytes))
  const name = archiveFileName(passphrase)
  downloadBytes(new TextEncoder().encode(html), name, 'text/html')
  return `Saved ${name} (${(html.length / 1024 / 1024).toFixed(1)} MB).`
}

/** In the hosted app: the built template (a static asset) with the current data spliced in. */
export async function downloadArchive(
  db: Database,
  appVersion: string,
  passphrase?: string,
): Promise<string> {
  const res = await fetchOwnAsset('/hearth-archive.html')
  if (!res.ok) throw new Error('the archive template is not part of this build (make frontend-build)')
  const template = await res.text()
  const bytes = await snapshotBytes(db, appVersion, passphrase)
  const html = splicePayload(template, encodePayload(bytes))
  const name = archiveFileName(passphrase)
  downloadBytes(new TextEncoder().encode(html), name, 'text/html')
  return `Downloaded ${name} (${(html.length / 1024 / 1024).toFixed(1)} MB). Double-click it in any desktop browser.`
}
