import { useEffect, useState } from 'react'
import { APP_VERSION, useApp } from '../app/context'
import { listConsents, revokeConsent } from '../consent/consent'
import { CONSENTS } from '../consent/kinds'
import {
  eraseEverything,
  importCalls,
  listSharing,
  listSourceFiles,
  newId,
  personCalls,
  setParent,
} from '../db/repo'
import { buildDump, type DumpV1, deserialiseDump, expandDump, serialiseDump } from '../export/dump'
import type { Person } from '../types'

export function SettingsPage() {
  const { db, persons, relationships, refresh } = useApp()
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [consents, setConsents] = useState<Awaited<ReturnType<typeof listConsents>>>([])
  const [sharing, setSharing] = useState<Awaited<ReturnType<typeof listSharing>>>([])
  const reload = async () => {
    setConsents(await listConsents(db))
    setSharing(await listSharing(db))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per db
  useEffect(() => {
    reload()
  }, [db])

  const exportDump = async () => {
    setMsg('Building dump…')
    const callsByPerson: Record<
      string,
      ReturnType<typeof personCalls> extends Promise<infer T> ? T : never
    > = {}
    for (const p of persons) callsByPerson[p.id] = await personCalls(db, p.id)
    const dump = buildDump({
      appVersion: APP_VERSION,
      persons,
      relationships,
      sourceFiles: await listSourceFiles(db),
      callsByPerson,
      consents,
      sharingLog: sharing,
      notes: await db.query('SELECT * FROM note'),
      chats: await db.query('SELECT * FROM chat'),
    })
    const bytes = await serialiseDump(dump, pass || undefined)
    const name = `hearth-dump-${new Date().toISOString().slice(0, 10)}.json.gz${pass ? '.enc' : ''}`
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    a.click()
    URL.revokeObjectURL(url)
    setMsg(
      `Exported ${name} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)${pass ? ', encrypted' : ' — plaintext genetic data, keep it safe'}`,
    )
  }

  const importDump = async (file: File) => {
    try {
      setMsg('Reading dump…')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const dump: DumpV1 = await deserialiseDump(bytes, pass || undefined)
      const calls = expandDump(dump)
      const existing = new Set(persons.map((p) => p.id))
      let n = 0
      for (const p of dump.persons as Person[]) {
        if (existing.has(p.id)) continue
        await db.exec(
          'INSERT INTO person(id,label,display_name,sex,birth_year,notes,created_at) VALUES (?,?,?,?,?,?,?)',
          [p.id, p.label, p.displayName, p.sex, p.birthYear, p.notes, p.createdAt],
        )
        const sf = dump.source_files.find((s) => s.personId === p.id)
        await importCalls(
          db,
          p.id,
          {
            provider: sf?.provider ?? 'generic',
            build: sf?.build ?? '37',
            sha256: sf?.sha256 ?? '',
            originalName: sf?.originalName ?? file.name,
          },
          calls[p.id] ?? [],
        )
        n++
      }
      for (const r of dump.relationships) await setParent(db, r.parentId, r.childId)
      for (const c of dump.consents as {
        kind: string
        version: number
        subject: string
        grantedAt: string
        revokedAt: string | null
      }[]) {
        await db.exec('INSERT INTO consent(kind,version,subject,granted_at,revoked_at) VALUES (?,?,?,?,?)', [
          c.kind,
          c.version,
          c.subject,
          c.grantedAt,
          c.revokedAt,
        ])
      }
      await refresh()
      await reload()
      setMsg(`Imported ${n} people from dump v${dump.version} (${dump.exported_at}).`)
    } catch (e) {
      setMsg(`Import failed: ${e}`)
    }
  }

  return (
    <div>
      <h1>Settings & export</h1>
      <div className="card">
        <h2>Full dump</h2>
        <p className="muted">
          Everything: people, pedigree, genotypes, consents, notes, chats, sharing log. Gzipped JSON; add a
          passphrase to encrypt with AES-GCM. This file is the only backup — Hearth keeps no copy anywhere.
        </p>
        <div className="row">
          <label className="field">
            Passphrase (optional)
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
          <button type="button" className="primary" onClick={exportDump} disabled={persons.length === 0}>
            Export dump
          </button>
          <label className="btn">
            Import dump…{' '}
            <input
              type="file"
              hidden
              accept=".gz,.enc,.json"
              onChange={(e) => e.target.files?.[0] && importDump(e.target.files[0])}
            />
          </label>
        </div>
        {msg && <p>{msg}</p>}
      </div>

      <div className="card">
        <h2>Consents</h2>
        {consents.length === 0 ? (
          <p className="muted">none recorded</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Consent</th>
                <th>Subject</th>
                <th>Granted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {consents.map((c) => (
                <tr key={`${c.kind}-${c.subject}-${c.grantedAt}`}>
                  <td>
                    {CONSENTS[c.kind]?.title ?? c.kind} <span className="muted">v{c.version}</span>
                  </td>
                  <td>{persons.find((p) => p.id === c.subject)?.displayName ?? (c.subject || '—')}</td>
                  <td>{c.grantedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    {c.revokedAt ? (
                      <span className="muted">revoked</span>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          await revokeConsent(db, c.kind, c.subject)
                          await reload()
                        }}
                      >
                        revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Sharing log</h2>
        <p className="muted">
          Every context pack copied out of Hearth, with the exact text. Nothing else has ever left this
          device.
        </p>
        {sharing.length === 0 ? (
          <p className="muted">empty</p>
        ) : (
          <ul>
            {sharing.map((s) => (
              <li key={s.id}>
                <details>
                  <summary>
                    {s.createdAt.slice(0, 16).replace('T', ' ')} · {s.kind} → {s.destination} ·{' '}
                    {s.payload.length} chars
                  </summary>
                  <pre className="pack">{s.payload}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Erase everything</h2>
        <p className="muted">
          Deletes all people, genotypes, consents, notes and logs from this browser. There is nothing to
          recover afterwards unless you exported a dump.
        </p>
        <button
          type="button"
          className="danger"
          onClick={async () => {
            if (confirm('Erase all Hearth data on this device?')) {
              await eraseEverything(db)
              await refresh()
              await reload()
              setMsg('Erased.')
            }
          }}
        >
          Erase all data
        </button>
      </div>
      <p className="muted">
        Hearth {APP_VERSION} · storage:{' '}
        {db.persistent ? 'OPFS (persistent)' : 'memory (not persistent in this browser context)'} · id{' '}
        {newId().slice(0, 8)}
      </p>
    </div>
  )
}
