import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Provider } from '../types'
import { deriveKey } from './dump'

/**
 * Dump v2 (docs/architecture/storage/dump-v2.md): a zip holding a small plaintext header, a
 * manifest, the journal (everything but genotypes) and the original genome files, optionally
 * wrapped in an AES-GCM envelope whose header stays readable without the passphrase. The same
 * bytes serve the manual dump, the backup folder and the portable archive.
 */
export const CONTAINER_VERSION = 2

export interface Header {
  format: 'hearth-dump'
  version: typeof CONTAINER_VERSION
  generation: number
  /** Random id of the browser profile that wrote the file; never a machine identifier. */
  device: string
  exported_at: string
  encrypted: boolean
}

export interface GenomeEntry {
  path: string
  /** sha256 of the gzipped bytes stored at `path` (integrity, not identity). */
  sha256: string
  person_id: string
  /** The `source_file` row this is the original of; null for a reconstructed export. */
  source_file_id: string | null
  provider: Provider
  build: string
  kind: 'original' | 'reconstructed'
}

export interface Manifest {
  app_version: string
  profile: string
  genomes: GenomeEntry[]
}

export interface Journal {
  persons: unknown[]
  relationships: unknown[]
  source_files: unknown[]
  consents: unknown[]
  health_log: unknown[]
  notes: unknown[]
  chats: unknown[]
  sharing_log: unknown[]
}

export interface Container {
  header: Header
  manifest: Manifest
  journal: Journal
  /** path → gzipped provider text */
  genomes: Record<string, Uint8Array>
}

const MAGIC = strToU8('HRTH2')
const HEADER_ENTRY = 'header.json'

export function genomePath(sha256OfBytes: string): string {
  return `genomes/${sha256OfBytes}.txt.gz`
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const json = (v: unknown) => strToU8(JSON.stringify(v))

/** Container → bytes. With a passphrase the zip is encrypted and the header travels in front. */
export async function serialiseContainer(c: Container, passphrase?: string): Promise<Uint8Array> {
  // A manifest naming a genome the zip does not carry would restore nowhere; never write one.
  const absent = missingGenomes(c)
  if (absent.length) throw new Error(`snapshot incomplete: no bytes for ${absent.join(', ')}`)
  const header: Header = { ...c.header, encrypted: !!passphrase }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    [HEADER_ENTRY]: [json({ ...header, encrypted: false }), { level: 0 }],
    'manifest.json': [json(c.manifest), { level: 6 }],
    'journal.json': [json(c.journal), { level: 6 }],
  }
  for (const [path, bytes] of Object.entries(c.genomes)) entries[path] = [bytes, { level: 0 }]
  const zip = zipSync(entries)
  if (!passphrase) return zip
  const head = json(header)
  if (head.length > 0xffff) throw new Error('header too large')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, zip as BufferSource),
  )
  const out = new Uint8Array(MAGIC.length + 2 + head.length + 16 + 12 + ct.length)
  let o = 0
  out.set(MAGIC, o)
  o += MAGIC.length
  out[o++] = head.length >> 8
  out[o++] = head.length & 0xff
  out.set(head, o)
  o += head.length
  out.set(salt, o)
  o += 16
  out.set(nonce, o)
  o += 12
  out.set(ct, o)
  return out
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b
const isEnvelope = (b: Uint8Array) => MAGIC.every((m, i) => b[i] === m)

function parseHeader(bytes: Uint8Array): Header {
  const h = JSON.parse(strFromU8(bytes)) as Header
  if (h.format !== 'hearth-dump' || h.version !== CONTAINER_VERSION) throw new Error('not a hearth dump v2')
  return h
}

/** The plaintext header of a v2 file, or null if the bytes are not a v2 file at all. */
export function readHeader(bytes: Uint8Array): Header | null {
  if (isEnvelope(bytes)) {
    const len = (bytes[MAGIC.length] << 8) | bytes[MAGIC.length + 1]
    return parseHeader(bytes.subarray(MAGIC.length + 2, MAGIC.length + 2 + len))
  }
  if (!isZip(bytes)) return null
  const entries = unzipSync(bytes, { filter: (f) => f.name === HEADER_ENTRY })
  const raw = entries[HEADER_ENTRY]
  return raw ? parseHeader(raw) : null
}

/** Manifest paths the container has no verified bytes for. */
export function missingGenomes(c: Container): string[] {
  return c.manifest.genomes.filter((g) => !c.genomes[g.path]).map((g) => g.path)
}

/**
 * Copies the genomes `c` lacks from `from`, another snapshot. Paths are content hashes and every
 * entry was verified on open, so a match is the same file byte for byte. Returns how many it found.
 */
export function fillGenomes(c: Container, from: Container): number {
  let n = 0
  for (const path of missingGenomes(c)) {
    const bytes = from.genomes[path]
    if (bytes) {
      c.genomes[path] = bytes
      n++
    }
  }
  return n
}

/**
 * Bytes → container. Genome entries that are absent or fail their hash are left out rather than
 * failing the whole file; `missingGenomes` lists them, and the rest still restores.
 */
export async function openContainer(bytes: Uint8Array, passphrase?: string): Promise<Container> {
  let zip = bytes
  if (isEnvelope(bytes)) {
    if (!passphrase) throw new Error('this dump is encrypted; a passphrase is required')
    const len = (bytes[MAGIC.length] << 8) | bytes[MAGIC.length + 1]
    let o = MAGIC.length + 2 + len
    const salt = bytes.subarray(o, o + 16)
    o += 16
    const nonce = bytes.subarray(o, o + 12)
    o += 12
    const key = await deriveKey(passphrase, salt)
    zip = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce as BufferSource },
        key,
        bytes.subarray(o) as BufferSource,
      ),
    )
  }
  if (!isZip(zip)) throw new Error('not a hearth dump v2')
  const entries = unzipSync(zip)
  const header = parseHeader(entries[HEADER_ENTRY])
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as Manifest
  const journal = JSON.parse(strFromU8(entries['journal.json'])) as Journal
  const genomes: Record<string, Uint8Array> = {}
  for (const g of manifest.genomes) {
    const data = entries[g.path]
    if (data && (await sha256(data)) === g.sha256) genomes[g.path] = data
  }
  return { header: { ...header, encrypted: isEnvelope(bytes) }, manifest, journal, genomes }
}
