import { gzipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  type Container,
  genomePath,
  openContainer,
  readHeader,
  serialiseContainer,
  sha256,
} from './container'
import { buildDump, serialiseDump } from './dump'

async function sample(): Promise<Container> {
  const gz = gzipSync(strToU8('# x\nrs1\t1\t10\tAG\n'))
  const path = genomePath(await sha256(gz))
  return {
    header: {
      format: 'hearth-dump',
      version: 2,
      generation: 7,
      device: 'dev-1',
      exported_at: '2026-09-14T00:00:00Z',
      encrypted: false,
    },
    manifest: {
      app_version: '0.1.0',
      profile: 'default',
      genomes: [
        {
          path,
          sha256: await sha256(gz),
          person_id: 'p1',
          source_file_id: 'sf1',
          provider: 'generic',
          build: '37',
          kind: 'original',
        },
      ],
    },
    journal: {
      persons: [{ id: 'p1' }],
      relationships: [],
      source_files: [],
      consents: [],
      health_log: [],
      notes: [],
      chats: [],
      sharing_log: [],
    },
    genomes: { [path]: gz },
  }
}

describe('dump v2 container', () => {
  it('round-trips plaintext and exposes the header without opening', async () => {
    const c = await sample()
    const bytes = await serialiseContainer(c)
    expect(readHeader(bytes)).toMatchObject({ generation: 7, device: 'dev-1', encrypted: false })
    const back = await openContainer(bytes)
    expect(back.journal.persons).toEqual([{ id: 'p1' }])
    expect(back.genomes[c.manifest.genomes[0].path]).toEqual(c.genomes[c.manifest.genomes[0].path])
    expect(back.header.encrypted).toBe(false)
  })

  it('keeps the header readable on an encrypted file and needs the passphrase for the rest', async () => {
    const c = await sample()
    const bytes = await serialiseContainer(c, 'correct horse')
    expect(readHeader(bytes)).toMatchObject({ generation: 7, encrypted: true })
    await expect(openContainer(bytes)).rejects.toThrow(/passphrase/)
    await expect(openContainer(bytes, 'wrong')).rejects.toThrow()
    const back = await openContainer(bytes, 'correct horse')
    expect(back.header.encrypted).toBe(true)
    expect(back.manifest.genomes).toHaveLength(1)
  })

  it('rejects a tampered genome entry', async () => {
    const c = await sample()
    c.manifest.genomes[0].sha256 = '00'
    await expect(openContainer(await serialiseContainer(c))).rejects.toThrow(/corrupt/)
  })

  it('returns null for v1 files and other bytes', async () => {
    const v1 = await serialiseDump(
      buildDump({ appVersion: '0', persons: [], relationships: [], sourceFiles: [], callsByPerson: {} }),
    )
    expect(readHeader(v1)).toBeNull()
    expect(readHeader(strToU8('hello'))).toBeNull()
  })
})
