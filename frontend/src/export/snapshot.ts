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
} from '../db/repo'
import { type Container, type GenomeEntry, genomePath, serialiseContainer, sha256 } from './container'

/**
 * Builds the dump v2 container from the live database. Genomes come from the cached originals
 * written at import time; a person imported before the cache existed gets one reconstructed
 * generic-format file built inside the worker.
 */
export async function buildSnapshot(db: Database, appVersion: string): Promise<Container> {
  const persons = await listPersons(db)
  const sourceFiles = await listSourceFiles(db)
  const counts = await genotypeCounts(db)
  const genomes: Record<string, Uint8Array> = {}
  const entries: GenomeEntry[] = []
  const add = async (bytes: Uint8Array, e: Omit<GenomeEntry, 'path' | 'sha256'>) => {
    const hash = await sha256(bytes)
    const path = genomePath(hash)
    genomes[path] = bytes
    entries.push({ path, sha256: hash, ...e })
  }
  for (const p of persons) {
    const rows = counts[p.id] ?? 0
    if (rows === 0) continue
    const sfs = sourceFiles.filter((s) => s.personId === p.id)
    const cached = await Promise.all(sfs.map((s) => db.fileGet(genomeBlobName(s.sha256))))
    if (sfs.length > 0 && cached.every((c) => c !== null)) {
      for (let i = 0; i < sfs.length; i++)
        await add(cached[i]!, {
          person_id: p.id,
          source_file_id: sfs[i].id,
          provider: sfs[i].provider,
          build: sfs[i].build,
          kind: 'original',
        })
    } else {
      // Rebuilt once in the worker and cached; the name carries the row count, so a later import
      // for this person produces a fresh file and pruneBlobs drops the stale one.
      const name = rebuiltBlobName(p.id, rows)
      let bytes = await db.fileGet(name)
      if (!bytes) {
        bytes = await db.genomeGz(p.id)
        await db.filePut(name, bytes)
      }
      await add(bytes, {
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
    manifest: { app_version: appVersion, profile: Database.profile(), genomes: entries },
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
  }
}

/** Snapshot → bytes, the form every destination (download, folder, archive) consumes. */
export async function snapshotBytes(
  db: Database,
  appVersion: string,
  passphrase?: string,
): Promise<Uint8Array> {
  return serialiseContainer(await buildSnapshot(db, appVersion), passphrase || undefined)
}
