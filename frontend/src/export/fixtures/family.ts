import { gzipSync, strToU8, unzipSync, zipSync } from 'fflate'
import { type Container, type GenomeEntry, genomePath, seal, serialiseContainer, sha256 } from '../container'

/**
 * A synthetic two-person family for the backup fixtures next to this file. Nobody real: invented
 * names, invented genotypes on a handful of well-known rsids. `build.test.ts` writes the files.
 */
export const PASSPHRASE = 'fixture passphrase'

export const PARENT = { id: 'fx-parent', name: 'Test Parent' }
export const CHILD = { id: 'fx-child', name: 'Test Child' }

const GENOMES: Record<string, string> = {
  [PARENT.id]: [
    '# rsid\tchromosome\tposition\tgenotype',
    'rs4988235\t2\t136608646\tAG',
    'rs1801133\t1\t11856378\tCT',
    'rs429358\t19\t45411941\tTT',
    'rs7412\t19\t45412079\tCC',
    'rs12913832\t15\t28365618\tAG',
    '',
  ].join('\n'),
  [CHILD.id]: [
    '# rsid\tchromosome\tposition\tgenotype',
    'rs4988235\t2\t136608646\tGG',
    'rs1801133\t1\t11856378\tCC',
    'rs429358\t19\t45411941\tTT',
    'rs7412\t19\t45412079\tCT',
    'rs12913832\t15\t28365618\tAA',
    '',
  ].join('\n'),
}

/** Rows per synthetic genome, for assertions. */
export const ROWS = 5

const person = (p: { id: string; name: string }, label: string, sex: string, year: number) => ({
  id: p.id,
  label,
  display_name: p.name,
  sex,
  birth_year: year,
  notes: '',
  created_at: '2026-09-21T16:00:00.000Z',
})

export async function family(): Promise<Container> {
  const genomes: Record<string, Uint8Array> = {}
  const entries: GenomeEntry[] = []
  for (const [personId, text] of Object.entries(GENOMES)) {
    const gz = gzipSync(strToU8(text), { mtime: 0 })
    const hash = await sha256(gz)
    genomes[genomePath(hash)] = gz
    entries.push({
      path: genomePath(hash),
      sha256: hash,
      person_id: personId,
      source_file_id: null,
      provider: 'generic',
      build: '37',
      kind: 'reconstructed',
    })
  }
  return {
    header: {
      format: 'hearth-dump',
      version: 2,
      generation: 12,
      device: 'fixture-device',
      exported_at: '2026-09-21T16:14:00.000Z',
      encrypted: false,
    },
    manifest: { app_version: 'fixture', profile: 'default', genomes: entries },
    journal: {
      persons: [person(PARENT, 'parent', 'F', 1970), person(CHILD, 'child', 'M', 2000)],
      relationships: [{ parentId: PARENT.id, childId: CHILD.id }],
      source_files: [],
      consents: [],
      health_log: [
        {
          id: 'fx-h1',
          person_id: PARENT.id,
          date: '2026-09-20',
          time: '08:00',
          kind: 'symptom',
          title: 'Knee pain',
          body: '',
          source: '',
          body_part: 'knees',
          side: 'left',
          severity: 4,
          tags: 'arthritis',
          value: null,
          value2: null,
          unit: '',
          created_at: '2026-09-20T08:00:00.000Z',
        },
      ],
      notes: [],
      chats: [],
      sharing_log: [],
    },
    genomes,
  }
}

/** The whole family, as any healthy backup is written. */
export const complete = async () => serialiseContainer(await family())

/**
 * The broken shape seen in the field: the manifest still lists the child's genome but the zip
 * carries no entry for it. The writer refuses to produce this, so the zip is edited afterwards.
 */
export async function missingChild(): Promise<Uint8Array> {
  const c = await family()
  const childPath = c.manifest.genomes.find((g) => g.person_id === CHILD.id)!.path
  const entries = unzipSync(await serialiseContainer(c))
  delete entries[childPath]
  return zipSync(entries, { level: 0 })
}

export async function missingChildEncrypted(): Promise<Uint8Array> {
  return seal(await missingChild(), (await family()).header, PASSPHRASE)
}
