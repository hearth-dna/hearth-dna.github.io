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
import { rich, useT } from '../i18n/context'
import { sha256Hex } from '../import/unpack'
import type { Person } from '../types'
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
  onDraft: (d: HealthDraft, source: string, files?: File[]) => void
  onClose: () => void
}) {
  const { db } = useApp()
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [hint, setHint] = useState<DocumentHint>('auto')
  const [key, setKey] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [model, setModel] = useState(GEMINI_DEFAULT_MODEL)
  const [consented, setConsented] = useState(false)
  const [keepOriginals, setKeepOriginals] = useState(true)
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
      onDraft(draft, `gemini:${usedModel}:${hashes.join('+')}`, keepOriginals ? files : undefined)
      ref.current?.close()
    } catch (e) {
      setStage({ s: 'error', message: String(e) })
    }
  }

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>{t('readDocumentDialog.title', { name: person.displayName })}</h2>
      {key === null ? (
        <div>
          <p className="notice">{t('readDocumentDialog.keyNotice')}</p>
          <GeminiKeySteps open />
          <div className="row">
            <label className="field">
              {t('readDocumentDialog.apiKey')}
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
              {t('common.save')}
            </button>
            <button type="button" onClick={() => ref.current?.close()}>
              {t('common.cancel')}
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
          <p>{rich(t('readDocumentDialog.confirmIntro', { model }))}</p>
          <ul>
            {files.map((f) => (
              <li key={f.name}>
                {t('readDocumentDialog.fileLine', { name: f.name, kb: (f.size / 1024).toFixed(0) })}
              </li>
            ))}
          </ul>
          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={keepOriginals}
                onChange={(e) => setKeepOriginals(e.target.checked)}
              />{' '}
              {t('readDocumentDialog.keepOriginals')}
            </span>
          </label>
          <p className="muted">{t('readDocumentDialog.keepOriginalsHint')}</p>
          <div className="row">
            <button type="button" className="primary" disabled={stage.s === 'sending'} onClick={send}>
              {stage.s === 'sending' ? t('readDocumentDialog.sending') : t('readDocumentDialog.send')}
            </button>
            <button type="button" disabled={stage.s === 'sending'} onClick={() => setStage({ s: 'pick' })}>
              {t('readDocumentDialog.back')}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="muted">{t('readDocumentDialog.pickIntro')}</p>
          <label className="field">
            {t('readDocumentDialog.pages')}
            <input
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          <label className="field" style={{ marginTop: '0.6rem' }}>
            {t('readDocumentDialog.whatIsIt')}
            <select value={hint} onChange={(e) => setHint(e.target.value as DocumentHint)}>
              {DOCUMENT_HINTS.map((h) => (
                <option key={h} value={h}>
                  {t(`readDocumentDialog.hint.${h}`)}
                </option>
              ))}
            </select>
          </label>
          {tooBig && (
            <p className="danger">
              {t('readDocumentDialog.tooBig', {
                mb: (totalBytes / 1024 / 1024).toFixed(1),
                max: MAX_BYTES / 1024 / 1024,
              })}
            </p>
          )}
          {stage.s === 'error' && (
            <p className="danger">{t('readDocumentDialog.failed', { message: stage.message })}</p>
          )}
          <div className="row" style={{ marginTop: '0.8rem' }}>
            <button
              type="button"
              className="primary"
              disabled={files.length === 0 || tooBig}
              onClick={() => setStage(consented ? { s: 'confirm' } : { s: 'consent' })}
            >
              {t('readDocumentDialog.continue')}
            </button>
            <button type="button" onClick={() => ref.current?.close()}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      {key === null && (
        <div className="row" style={{ marginTop: '0.8rem' }}>
          <button type="button" onClick={() => ref.current?.close()}>
            {t('common.close')}
          </button>
        </div>
      )}
    </dialog>
  )
}
