import { useEffect, useState } from 'react'
import { APP_VERSION, useApp } from '../app/context'
import { listConsents, revokeConsent, revokeDeletesData } from '../consent/consent'
import { CONSENTS } from '../consent/kinds'
import {
  getMeta,
  importCalls,
  listSharing,
  META_GEMINI_KEY,
  META_GEMINI_MODEL,
  newId,
  setMeta,
  setParent,
} from '../db/repo'
import { GEMINI_DEFAULT_MODEL } from '../egress/egress'
import { type DumpV1, deserialiseDump, expandDump } from '../export/dump'
import { exportDumpFile } from '../export/exportDump'
import type { Person } from '../types'
import { EraseDialog } from './EraseDialog'

export function SettingsPage() {
  const { db, persons, relationships, refresh } = useApp()
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [consents, setConsents] = useState<Awaited<ReturnType<typeof listConsents>>>([])
  const [sharing, setSharing] = useState<Awaited<ReturnType<typeof listSharing>>>([])
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiModel, setGeminiModel] = useState(GEMINI_DEFAULT_MODEL)
  const [keyStored, setKeyStored] = useState(false)
  const [erasing, setErasing] = useState(false)
  const reload = async () => {
    setConsents(await listConsents(db))
    setSharing(await listSharing(db))
    setKeyStored((await getMeta(db, META_GEMINI_KEY)) !== null)
    setGeminiModel((await getMeta(db, META_GEMINI_MODEL)) || GEMINI_DEFAULT_MODEL)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per db
  useEffect(() => {
    reload()
  }, [db])

  const exportDump = async () => {
    setMsg('Building dump…')
    setMsg(await exportDumpFile(db, APP_VERSION, persons, relationships, pass))
  }

  const importDump = async (file: File) => {
    try {
      setMsg('Reading dump…')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const dump: DumpV1 = await deserialiseDump(bytes, pass || undefined)
      const calls = expandDump(dump)
      const existing = new Set(persons.map((p) => p.id))
      const added = new Set<string>()
      let n = 0
      for (const p of dump.persons as Person[]) {
        if (existing.has(p.id)) continue
        added.add(p.id)
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
      for (const h of (dump.health_log ?? []) as Record<string, unknown>[]) {
        if (!added.has(h.person_id as string)) continue
        await db.exec(
          'INSERT INTO health_log(id,person_id,date,kind,title,body,source,created_at) VALUES (?,?,?,?,?,?,?,?)',
          [h.id, h.person_id, h.date, h.kind, h.title, h.body, h.source ?? '', h.created_at],
        )
      }
      for (const c of dump.consents as {
        kind: string
        version: number
        subject: string
        grantedAt: string
        revokedAt?: string | null
      }[]) {
        if (c.revokedAt) continue // dumps from before revoke-is-delete
        await db.exec('INSERT INTO consent(kind,version,subject,granted_at) VALUES (?,?,?,?)', [
          c.kind,
          c.version,
          c.subject,
          c.grantedAt,
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
        <h2>Document reading (your own Gemini key)</h2>
        <p className="muted">
          Optional. Lets "Read a document" on a person's health log send a photo, scan or PDF straight from
          this browser to Google Gemini for transcription. The key is stored only in this browser's database
          and is never part of a dump. Nothing is sent until you confirm each document.
        </p>
        <p className="notice">
          On Google's free tier, content you send may be used to improve their models. Use a key from a paid
          project if that matters to you.
        </p>
        <div className="row">
          <label className="field">
            API key {keyStored && <span className="ok">(stored)</span>}
            <input
              type="password"
              autoComplete="off"
              value={geminiKey}
              placeholder={keyStored ? '•••••••• (enter a new key to replace)' : 'AIza…'}
              onChange={(e) => setGeminiKey(e.target.value)}
            />
          </label>
          <label className="field">
            Model
            <input value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!geminiKey.trim() && !keyStored}
            onClick={async () => {
              if (geminiKey.trim()) await setMeta(db, META_GEMINI_KEY, geminiKey.trim())
              await setMeta(
                db,
                META_GEMINI_MODEL,
                geminiModel.trim() === GEMINI_DEFAULT_MODEL ? null : geminiModel.trim(),
              )
              setGeminiKey('')
              await reload()
              setMsg('Gemini settings saved.')
            }}
          >
            Save
          </button>
          {keyStored && (
            <button
              type="button"
              className="danger"
              onClick={async () => {
                await setMeta(db, META_GEMINI_KEY, null)
                await reload()
                setMsg('Gemini key removed.')
              }}
            >
              Remove key
            </button>
          )}
        </div>
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
                <th />
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
                    <button
                      type="button"
                      className="danger"
                      onClick={async () => {
                        const who = persons.find((p) => p.id === c.subject)?.displayName ?? c.subject
                        const what = c.kind === 'import_document' ? 'health log' : 'genome'
                        if (
                          revokeDeletesData(c.kind) &&
                          !confirm(`Revoke and delete ${who}'s ${what}? This cannot be undone.`)
                        )
                          return
                        await revokeConsent(db, c.kind, c.subject)
                        // Withdrawing the first-launch consent puts the app back behind the gate.
                        if (c.kind === 'first_launch') return location.reload()
                        await refresh()
                        await reload()
                      }}
                    >
                      revoke
                    </button>
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
          Every context pack copied out of Hearth, with the exact text, and every document sent to a provider
          with your key (file names and hashes; the file itself is not kept). Nothing else has ever left this
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
        <button type="button" className="danger" onClick={() => setErasing(true)}>
          Erase all data
        </button>
        {erasing && <EraseDialog onClose={() => setErasing(false)} />}
      </div>
      <p className="muted">
        Hearth {APP_VERSION} · storage:{' '}
        {db.persistent ? 'OPFS (persistent)' : 'memory (not persistent in this browser context)'} · id{' '}
        {newId().slice(0, 8)}
      </p>
    </div>
  )
}
