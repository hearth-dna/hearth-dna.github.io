import type { Call, Person, SourceFile } from '../types'

/**
 * Dump v1 (docs/design.md §6.5). Genotypes are stored per person as a compact string table over a
 * shared SNP index so seven genomes gzip to a few MB. Optional AES-GCM with a PBKDF2 key.
 */
export const DUMP_FORMAT = 'hearth-dump'
export const DUMP_VERSION = 1

export interface DumpV1 {
  format: typeof DUMP_FORMAT
  version: typeof DUMP_VERSION
  app_version: string
  exported_at: string
  persons: Person[]
  relationships: { parentId: string; childId: string }[]
  source_files: SourceFile[]
  snp_index: { rsids: string[]; chromosomes: string[]; positions: number[] }
  /** personId → string of 2 chars per snp_index entry ("AG", "--" = absent) */
  genotypes: Record<string, string>
  consents: unknown[]
  notes: unknown[]
  chats: unknown[]
  sharing_log: unknown[]
}

export interface DumpInput {
  appVersion: string
  persons: Person[]
  relationships: { parentId: string; childId: string }[]
  sourceFiles: SourceFile[]
  callsByPerson: Record<string, Call[]>
  consents?: unknown[]
  notes?: unknown[]
  chats?: unknown[]
  sharingLog?: unknown[]
}

export function buildDump(input: DumpInput): DumpV1 {
  const index = new Map<string, number>()
  const rsids: string[] = []
  const chromosomes: string[] = []
  const positions: number[] = []
  for (const calls of Object.values(input.callsByPerson)) {
    for (const c of calls) {
      if (!index.has(c.rsid)) {
        index.set(c.rsid, rsids.length)
        rsids.push(c.rsid)
        chromosomes.push(c.chromosome)
        positions.push(c.position)
      }
    }
  }
  const genotypes: Record<string, string> = {}
  for (const [pid, calls] of Object.entries(input.callsByPerson)) {
    const arr = new Array<string>(rsids.length).fill('--')
    for (const c of calls) arr[index.get(c.rsid)!] = c.a1 + c.a2
    genotypes[pid] = arr.join('')
  }
  return {
    format: DUMP_FORMAT,
    version: DUMP_VERSION,
    app_version: input.appVersion,
    exported_at: new Date().toISOString(),
    persons: input.persons,
    relationships: input.relationships,
    source_files: input.sourceFiles,
    snp_index: { rsids, chromosomes, positions },
    genotypes,
    consents: input.consents ?? [],
    notes: input.notes ?? [],
    chats: input.chats ?? [],
    sharing_log: input.sharingLog ?? [],
  }
}

export function expandDump(d: DumpV1): Record<string, Call[]> {
  if (d.format !== DUMP_FORMAT || d.version !== DUMP_VERSION)
    throw new Error(`unsupported dump ${d.format} v${d.version}`)
  const out: Record<string, Call[]> = {}
  const { rsids, chromosomes, positions } = d.snp_index
  for (const [pid, s] of Object.entries(d.genotypes)) {
    const calls: Call[] = []
    for (let i = 0; i < rsids.length; i++) {
      const a1 = s[i * 2]
      const a2 = s[i * 2 + 1]
      if (a1 === '-' && a2 === '-') continue
      calls.push({ rsid: rsids[i], chromosome: chromosomes[i], position: positions[i], a1, a2 })
    }
    out[pid] = calls
  }
  return out
}

// ---- bytes: gzip + optional AES-GCM ---------------------------------------------------------

export async function gzipBytes(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function gunzipBytes(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

const ENC_MAGIC = new TextEncoder().encode('HRTH1') // 5 bytes, then 16 salt, 12 nonce, ciphertext
const PBKDF2_ITERATIONS = 600_000

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptBytes(plain: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, plain as BufferSource),
  )
  const out = new Uint8Array(ENC_MAGIC.length + 16 + 12 + ct.length)
  out.set(ENC_MAGIC, 0)
  out.set(salt, ENC_MAGIC.length)
  out.set(nonce, ENC_MAGIC.length + 16)
  out.set(ct, ENC_MAGIC.length + 28)
  return out
}

export function isEncrypted(bytes: Uint8Array): boolean {
  return ENC_MAGIC.every((b, i) => bytes[i] === b)
}

export async function decryptBytes(bytes: Uint8Array, passphrase: string): Promise<Uint8Array> {
  if (!isEncrypted(bytes)) throw new Error('not an encrypted dump')
  const salt = bytes.slice(ENC_MAGIC.length, ENC_MAGIC.length + 16)
  const nonce = bytes.slice(ENC_MAGIC.length + 16, ENC_MAGIC.length + 28)
  const ct = bytes.slice(ENC_MAGIC.length + 28)
  const key = await deriveKey(passphrase, salt)
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, ct as BufferSource),
  )
}

/** Full pipeline: dump → JSON → gzip → (encrypt). */
export async function serialiseDump(d: DumpV1, passphrase?: string): Promise<Uint8Array> {
  const gz = await gzipBytes(JSON.stringify(d))
  return passphrase ? encryptBytes(gz, passphrase) : gz
}

export async function deserialiseDump(bytes: Uint8Array, passphrase?: string): Promise<DumpV1> {
  let gz = bytes
  if (isEncrypted(bytes)) {
    if (!passphrase) throw new Error('this dump is encrypted; a passphrase is required')
    gz = await decryptBytes(bytes, passphrase)
  }
  return JSON.parse(await gunzipBytes(gz)) as DumpV1
}
