import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { getMeta, logSharing, META_GEMINI_KEY, META_GEMINI_MODEL, setMeta } from '../db/repo'
import {
  DOCUMENT_HINTS,
  DOCUMENT_SCHEMA,
  type DocumentHint,
  documentPrompt,
  draftFromJson,
  type HealthDraft,
} from '../documents/draft'
import { type DocumentPart, GEMINI_DEFAULT_MODEL, readDocumentWithGemini } from '../egress/egress'
import { sha256Hex } from '../import/unpack'
import { HEALTH_KIND_LABELS, type Person } from '../types'
import { ConsentForm } from './ConsentForm'
import { GeminiKeySteps } from './GeminiKeySteps'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf'
const MAX_BYTES = 15 * 1024 * 1024 // Gemini inline limit is 20 MB per request; keep headroom for base64

type Stage =
  | { s: 'pick' }
  | { s: 'consent' }
  | { s: 'confirm' }
  | { s: 'sending' }
  | { s: 'error'; message: string }

async function toBase64(file: File): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
  return url.slice(url.indexOf(',') + 1)
}

/**
 * Tier 3 document reader: the chosen pages go straight from this browser to Gemini with the
 * user's own key, the reply is parsed into a draft the health-log form shows for review. Every
 * send is confirmed here and written to the sharing log (metadata only, never the file).
 */
export function ReadDocumentDialog({
  person,
  onDraft,
  onClose,
}: {
  person: Person
  onDraft: (d: HealthDraft, source: string) => void
  onClose: () => void
}) {
  const { db } = useApp()
  const ref = useRef<HTMLDialogElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [hint, setHint] = useState<DocumentHint>('auto')
  const [key, setKey] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [model, setModel] = useState(GEMINI_DEFAULT_MODEL)
  const [consented, setConsented] = useState(false)
  const [stage, setStage] = useState<Stage>({ s: 'pick' })

  useEffect(() => {
    ref.current?.showModal()
    ;(async () => {
      setKey(await getMeta(db, META_GEMINI_KEY))
      setModel((await getMeta(db, META_GEMINI_MODEL)) || GEMINI_DEFAULT_MODEL)
      setConsented(await hasConsent(db, 'read_document_byok'))
    })()
  }, [db])

  const totalBytes = files.reduce((n, f) => n + f.size, 0)
  const tooBig = totalBytes > MAX_BYTES

  const send = async () => {
    if (!key) return
    setStage({ s: 'sending' })
    try {
      const parts: DocumentPart[] = []
      const hashes: string[] = []
      for (const f of files) {
        parts.push({ mime: f.type, data: await toBase64(f) })
        hashes.push(await sha256Hex(new Uint8Array(await f.arrayBuffer())))
      }
      const confirmed = { confirmedAt: new Date().toISOString() }
      const meta = {
        person: person.label,
        files: files.map((f, i) => ({ name: f.name, type: f.type, bytes: f.size, sha256: hashes[i] })),
        hint,
        model,
      }
      const { text, model: usedModel } = await readDocumentWithGemini(
        { byokKey: key, model },
        parts,
        documentPrompt(hint),
        DOCUMENT_SCHEMA,
        confirmed,
      )
      await logSharing(db, 'document', `gemini:${usedModel}`, JSON.stringify(meta, null, 2))
      const draft = draftFromJson(text, new Date().toISOString().slice(0, 10))
      onDraft(draft, `gemini:${usedModel}:${hashes.join('+')}`)
      ref.current?.close()
    } catch (e) {
      setStage({ s: 'error', message: String(e) })
    }
  }

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>Read a document for {person.displayName}</h2>
      {key === null ? (
        <div>
          <p className="notice">
            To read a photo, scan or PDF, Hearth sends it from this browser to Google Gemini using a key that
            belongs to you. You need to add that key once.
          </p>
          <GeminiKeySteps open />
          <div className="row">
            <label className="field">
              API key
              <input
                type="password"
                autoComplete="off"
                placeholder="AIza…"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary"
              disabled={!newKey.trim()}
              onClick={async () => {
                await setMeta(db, META_GEMINI_KEY, newKey.trim())
                setKey(newKey.trim())
                setNewKey('')
              }}
            >
              Save
            </button>
            <button type="button" onClick={() => ref.current?.close()}>
              Cancel
            </button>
          </div>
        </div>
      ) : stage.s === 'consent' ? (
        <ConsentForm
          kind="read_document_byok"
          onCancel={() => setStage({ s: 'pick' })}
          onConfirm={async () => {
            await grantConsent(db, 'read_document_byok')
            setConsented(true)
            setStage({ s: 'confirm' })
          }}
        />
      ) : stage.s === 'confirm' || stage.s === 'sending' ? (
        <div>
          <p>
            These files will leave this device and go to <strong>Google Gemini ({model})</strong> with your
            key. The reply is shown for review before anything is saved.
          </p>
          <ul>
            {files.map((f) => (
              <li key={f.name}>
                {f.name} · {(f.size / 1024).toFixed(0)} KB
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="primary" disabled={stage.s === 'sending'} onClick={send}>
              {stage.s === 'sending' ? 'Sending…' : 'I have checked the files — send'}
            </button>
            <button type="button" disabled={stage.s === 'sending'} onClick={() => setStage({ s: 'pick' })}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="muted">
            Photos or scans (JPEG, PNG, WebP, HEIC) or a PDF. Cover the patient name if you can; the model is
            told to leave identifiers out, but what you send is what the provider sees.
          </p>
          <label className="field">
            Pages
            <input
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          <label className="field" style={{ marginTop: '0.6rem' }}>
            What is it
            <select value={hint} onChange={(e) => setHint(e.target.value as DocumentHint)}>
              {DOCUMENT_HINTS.map((h) => (
                <option key={h} value={h}>
                  {h === 'auto' ? 'Let the model decide' : HEALTH_KIND_LABELS[h]}
                </option>
              ))}
            </select>
          </label>
          {tooBig && (
            <p className="danger">
              {(totalBytes / 1024 / 1024).toFixed(1)} MB selected; the limit is {MAX_BYTES / 1024 / 1024} MB
              per document. Split it or downscale the photos.
            </p>
          )}
          {stage.s === 'error' && <p className="danger">Failed: {stage.message}</p>}
          <div className="row" style={{ marginTop: '0.8rem' }}>
            <button
              type="button"
              className="primary"
              disabled={files.length === 0 || tooBig}
              onClick={() => setStage(consented ? { s: 'confirm' } : { s: 'consent' })}
            >
              Continue…
            </button>
            <button type="button" onClick={() => ref.current?.close()}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {key === null && (
        <div className="row" style={{ marginTop: '0.8rem' }}>
          <button type="button" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
      )}
    </dialog>
  )
}
