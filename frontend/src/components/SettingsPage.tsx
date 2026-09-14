import { useEffect, useState } from 'react'
import { APP_VERSION, useApp } from '../app/context'
import { listConsents, revokeConsent, revokeDeletesData } from '../consent/consent'
import { CONSENTS } from '../consent/kinds'
import { getMeta, listSharing, META_GEMINI_KEY, META_GEMINI_MODEL, newId, setMeta } from '../db/repo'
import { GEMINI_DEFAULT_MODEL } from '../egress/egress'
import { exportDumpFile } from '../export/exportDump'
import { restoreBytes } from '../export/restore'
import { ArchiveCard } from './ArchiveCard'
import { BackupCard } from './BackupCard'
import { EraseDialog } from './EraseDialog'
import { GeminiKeySteps } from './GeminiKeySteps'

export function SettingsPage() {
  const { db, persons, refresh } = useApp()
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
    setMsg(await exportDumpFile(db, APP_VERSION, pass))
  }

  const importDump = async (file: File) => {
    try {
      setMsg('Reading dump…')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const r = await restoreBytes(db, bytes, pass || undefined, setMsg)
      await refresh()
      await reload()
      setMsg(
        `Imported ${r.people} new people and ${r.genomes} genomes from dump v${r.version} (${r.exportedAt}); people already here were left unchanged.`,
      )
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
          Everything: people, pedigree, the original genome files, consents, health log, notes, chats, sharing
          log. One .hearth file; add a passphrase to encrypt it with AES-GCM. Hearth keeps no copy anywhere.
          Import accepts .hearth files, older .json.gz dumps and portable .html archives.
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
              accept=".hearth,.enc,.gz,.json,.html"
              onChange={(e) => e.target.files?.[0] && importDump(e.target.files[0])}
            />
          </label>
        </div>
        {msg && <p>{msg}</p>}
      </div>

      <BackupCard />
      <ArchiveCard />

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
        <GeminiKeySteps open={!keyStored} />
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
