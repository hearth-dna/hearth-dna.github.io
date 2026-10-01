import { listConsents } from '../consent/consent'
import { Database } from '../db/db'
import {
  genomeBlobName,
  genotypeCounts,
  getMeta,
  listPersons,
  listRelationships,
  listSourceFiles,
  rebuiltBlobName,
  setMeta,
} from '../db/repo'
import { type Container, type GenomeEntry, genomePath, serialiseContainer, sha256 } from './container'

/** A genome file a folder snapshot refers to: where it goes in the folder, and its cached bytes. */
export interface GenomeFile {
  /** `genomes/<sha256>.txt.gz`, the path the manifest names. */
  path: string
  /** The file-cache blob holding the bytes (db.fileGet). */
  blob: string
}

/**
 * The sha256 of a cached genome blob, computed once and remembered in `meta` (which bumps no
 * generation and wakes no autosave). With it a folder snapshot never reads genome bytes at all.
 */
async function blobSha(db: Database, blob: string, bytes?: Uint8Array): Promise<string> {
  const key = `genome-sha:${blob}`
  const known = await getMeta(db, key)
  if (known) return known
  const data = bytes ?? (await db.fileGet(blob))
  if (!data) throw new Error(`genome file ${blob} is missing from this device`)
  const hash = await sha256(data)
  await setMeta(db, key, hash)
  return hash
}

/**
 * Builds the dump v2 container from the live database. Genomes come from the cached originals
 * written at import time; a person imported before the cache existed gets one reconstructed
 * generic-format file built inside the worker.
 *
 * `embed: false` is the backup folder's form: the manifest lists every genome, but the bytes stay
 * out of the snapshot and travel beside it as write-once files (`files`), so a backup after an edit
 * uploads the journal alone instead of every genome again.
 */
export async function buildSnapshot(
  db: Database,
  appVersion: string,
  embed = true,
): Promise<Container & { files: GenomeFile[] }> {
  const persons = await listPersons(db)
  const sourceFiles = await listSourceFiles(db)
  const counts = await genotypeCounts(db)
  const cachedBlobs = new Set(await db.fileList())
  const genomes: Record<string, Uint8Array> = {}
  const entries: GenomeEntry[] = []
  const files: GenomeFile[] = []
  const add = async (blob: string, e: Omit<GenomeEntry, 'path' | 'sha256'>) => {
    const bytes = embed ? await db.fileGet(blob) : undefined
    if (embed && !bytes) throw new Error(`genome file ${blob} is missing from this device`)
    const hash = await blobSha(db, blob, bytes ?? undefined)
    const path = genomePath(hash)
    if (bytes) genomes[path] = bytes
    else files.push({ path, blob })
    entries.push({ path, sha256: hash, ...e })
  }
  for (const p of persons) {
    const rows = counts[p.id] ?? 0
    if (rows === 0) continue
    const sfs = sourceFiles.filter((s) => s.personId === p.id)
    if (sfs.length > 0 && sfs.every((s) => cachedBlobs.has(genomeBlobName(s.sha256)))) {
      for (const sf of sfs)
        await add(genomeBlobName(sf.sha256), {
          person_id: p.id,
          source_file_id: sf.id,
          provider: sf.provider,
          build: sf.build,
          kind: 'original',
        })
    } else {
      // Rebuilt once in the worker and cached; the name carries the row count, so a later import
      // for this person produces a fresh file and pruneBlobs drops the stale one.
      const name = rebuiltBlobName(p.id, rows)
      if (!cachedBlobs.has(name)) await db.filePut(name, await db.genomeGz(p.id))
      await add(name, {
        person_id: p.id,
        source_file_id: null,
        provider: 'generic',
        build: sfs[0]?.build ?? '37',
        kind: 'reconstructed',
      })
    }
  }
  return {
    header: {
      format: 'hearth-dump',
      version: 2,
      generation: Number((await getMeta(db, 'generation')) ?? 0),
      device: (await getMeta(db, 'device')) ?? '',
      exported_at: new Date().toISOString(),
      encrypted: false,
    },
    manifest: {
      app_version: appVersion,
      profile: Database.profile(),
      genomes: entries,
      ...(embed ? {} : { external_genomes: true }),
    },
    journal: {
      persons: await db.query('SELECT * FROM person'),
      relationships: await listRelationships(db),
      source_files: await db.query('SELECT * FROM source_file'),
      consents: await listConsents(db),
      health_log: await db.query('SELECT * FROM health_log'),
      attachments: await db.query('SELECT * FROM attachment'),
      notes: await db.query('SELECT * FROM note'),
      chats: await db.query('SELECT * FROM chat'),
      sharing_log: await db.query('SELECT kind, destination, payload, created_at FROM sharing_log'),
    },
    genomes,
    files,
  }
}

/** Snapshot → bytes, genomes inside: the manual dump and the portable archive. */
export async function snapshotBytes(
  db: Database,
  appVersion: string,
  passphrase?: string,
): Promise<Uint8Array> {
  return serialiseContainer(await buildSnapshot(db, appVersion), passphrase || undefined)
}

/** Snapshot → bytes with the genomes beside it: the backup folder's form (see `buildSnapshot`). */
export async function folderSnapshot(
  db: Database,
  appVersion: string,
  passphrase?: string,
): Promise<{ bytes: Uint8Array; files: GenomeFile[] }> {
  const c = await buildSnapshot(db, appVersion, false)
  return { bytes: await serialiseContainer(c, passphrase || undefined), files: c.files }
}
