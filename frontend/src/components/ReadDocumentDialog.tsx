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
import { parseLabText, type TextParse } from '../labs/parseText'
import { pdfText } from '../labs/pdfText'
import { labDraftFromJson, labPrompt, labSchema } from '../labs/prompt'
import type { LabReportDraft } from '../labs/types'
import type { Person } from '../types'
import { ConsentForm } from './ConsentForm'
import { GeminiKeySteps } from './GeminiKeySteps'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf'
/** Lab reports may also be text: a portal export, a CSV or TSV from the lab system. */
const ACCEPT_LAB = `${ACCEPT},text/plain,text/csv,text/tab-separated-values,.txt,.csv,.tsv`
const MAX_BYTES = 15 * 1024 * 1024 // Gemini inline limit is 20 MB per request; keep headroom for base64

type Stage =
  | { s: 'pick' }
  | { s: 'reading' }
  /** Read on this device, but only part of it: offer the model for the rest. */
  | { s: 'partial'; parse: TextParse; source: string }
  | { s: 'key' }
  | { s: 'consent' }
  | { s: 'confirm' }
  | { s: 'sending' }
  | { s: 'error'; message: string }

const isText = (f: File) => /^text\//.test(f.type) || /\.(txt|csv|tsv)$/i.test(f.name)
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const encode = (s: string) => new TextEncoder().encode(s)

async function toBase64(bytes: Uint8Array): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(new Blob([bytes as BlobPart]))
  })
  return url.slice(url.indexOf(',') + 1)
}

/**
 * Reads a document into a health-log draft. A lab report that is text (pasted, a .txt/.csv/.tsv
 * file, or a PDF with a text layer) is read on this device and nothing leaves it. Photos and
 * scans go straight from this browser to Gemini with the user's own key (tier 3): every send is
 * confirmed here and written to the sharing log (metadata only, never the file). Either way the
 * result is shown for review before anything is saved.
 */
export function ReadDocumentDialog({
  person,
  onDraft,
  onLabDraft,
  onClose,
}: {
  person: Person
  onDraft: (d: HealthDraft, source: string) => void
  onLabDraft: (d: LabReportDraft, source: string) => void
  onClose: () => void
}) {
  const { db, kb } = useApp()
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [pasted, setPasted] = useState('')
  const [hint, setHint] = useState<DocumentHint>('auto')
  const [key, setKey] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [model, setModel] = useState(GEMINI_DEFAULT_MODEL)
  const [consented, setConsented] = useState(false)
  const [stage, setStage] = useState<Stage>({ s: 'pick' })
  /** What goes to the model: the chosen files, and text this device could not fully read. */
  const [parts, setParts] = useState<{ name: string; mime: string; bytes: Uint8Array }[]>([])

  useEffect(() => {
    ref.current?.showModal()
    ;(async () => {
      setKey(await getMeta(db, META_GEMINI_KEY))
      setModel((await getMeta(db, META_GEMINI_MODEL)) || GEMINI_DEFAULT_MODEL)
      setConsented(await hasConsent(db, 'read_document_byok'))
    })()
  }, [db])

  const lab = hint === 'lab'
  const sendBytes = parts.reduce((n, p) => n + p.bytes.length, 0)
  const pickedBytes = files.reduce((n, f) => n + f.size, 0)
  const tooBig = pickedBytes > MAX_BYTES

  const toModel = (next: typeof parts) => {
    setParts(next)
    setStage(!key ? { s: 'key' } : consented ? { s: 'confirm' } : { s: 'consent' })
  }

  const done = (draft: LabReportDraft, source: string) => {
    onLabDraft(draft, source)
    ref.current?.close()
  }

  /** Continue: a lab report is read here when it is text; anything else goes to the model. */
  const next = async () => {
    const all = await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        mime: f.type || 'text/plain',
        bytes: new Uint8Array(await f.arrayBuffer()),
      })),
    )
    if (!lab) return toModel(all)
    setStage({ s: 'reading' })
    try {
      const texts = pasted.trim() ? [pasted] : []
      const rest: typeof all = []
      for (const [i, f] of files.entries()) {
        if (isText(f)) texts.push(new TextDecoder().decode(all[i].bytes))
        else if (isPdf(f)) {
          const text = await pdfText(all[i].bytes).catch(() => null)
          if (text) texts.push(text)
          else rest.push(all[i])
        } else rest.push(all[i])
      }
      // A photo or scan among them: the whole report goes to the model, so it is read as one.
      if (rest.length)
        return toModel([
          ...rest,
          ...texts.map((s, i) => ({ name: `text-${i + 1}.txt`, mime: 'text/plain', bytes: encode(s) })),
        ])
      const text = texts.join('\n')
      const parse = parseLabText(kb, text)
      const source = `text:${await sha256Hex(encode(text))}`
      if (parse.draft.rows.length && parse.draft.rows.length * 2 >= parse.candidates)
        return done(parse.draft, source)
      setParts([{ name: 'report.txt', mime: 'text/plain', bytes: encode(text) }])
      setStage({ s: 'partial', parse, source })
    } catch (e) {
      setStage({ s: 'error', message: String(e) })
    }
  }

  const send = async () => {
    if (!key) return
    setStage({ s: 'sending' })
    try {
      const payload: DocumentPart[] = []
      const hashes: string[] = []
      for (const p of parts) {
        payload.push({ mime: p.mime, data: await toBase64(p.bytes) })
        hashes.push(await sha256Hex(p.bytes))
      }
      const confirmed = { confirmedAt: new Date().toISOString() }
      const meta = {
        person: person.label,
        files: parts.map((p, i) => ({
          name: p.name,
          type: p.mime,
          bytes: p.bytes.length,
          sha256: hashes[i],
        })),
        hint,
        model,
      }
      const { text, model: usedModel } = await readDocumentWithGemini(
        { byokKey: key, model },
        payload,
        lab ? labPrompt(kb) : documentPrompt(hint),
        lab ? labSchema(kb) : DOCUMENT_SCHEMA,
        confirmed,
      )
      await logSharing(db, 'document', `gemini:${usedModel}`, JSON.stringify(meta, null, 2))
      const source = `gemini:${usedModel}:${hashes.join('+')}`
      if (lab) return done(labDraftFromJson(kb, text), source)
      onDraft(draftFromJson(text, new Date().toISOString().slice(0, 10)), source)
      ref.current?.close()
    } catch (e) {
      setStage({ s: 'error', message: String(e) })
    }
  }

  const close = (
    <button type="button" onClick={() => ref.current?.close()}>
      {t('common.cancel')}
    </button>
  )

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 className="mt-0">{t('readDocumentDialog.title', { name: person.displayName })}</h2>
      {stage.s === 'key' ? (
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
                setStage(consented ? { s: 'confirm' } : { s: 'consent' })
              }}
            >
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setStage({ s: 'pick' })}>
              {t('readDocumentDialog.back')}
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
            {parts.map((p) => (
              <li key={p.name}>
                {t('readDocumentDialog.fileLine', { name: p.name, kb: (p.bytes.length / 1024).toFixed(0) })}
              </li>
            ))}
          </ul>
          {sendBytes > MAX_BYTES && (
            <p className="danger">
              {t('readDocumentDialog.tooBig', {
                mb: (sendBytes / 1024 / 1024).toFixed(1),
                max: MAX_BYTES / 1024 / 1024,
              })}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={stage.s === 'sending' || sendBytes > MAX_BYTES}
              onClick={send}
            >
              {stage.s === 'sending' ? t('readDocumentDialog.sending') : t('readDocumentDialog.send')}
            </button>
            <button type="button" disabled={stage.s === 'sending'} onClick={() => setStage({ s: 'pick' })}>
              {t('readDocumentDialog.back')}
            </button>
          </div>
        </div>
      ) : stage.s === 'partial' ? (
        <div>
          <p className="notice">
            {stage.parse.draft.rows.length
              ? t('readDocumentDialog.localPartial', {
                  n: stage.parse.draft.rows.length,
                  m: stage.parse.candidates,
                })
              : t('readDocumentDialog.localNothing')}
          </p>
          <div className="row">
            {stage.parse.draft.rows.length > 0 && (
              <button type="button" className="primary" onClick={() => done(stage.parse.draft, stage.source)}>
                {t('readDocumentDialog.reviewFound', { n: stage.parse.draft.rows.length })}
              </button>
            )}
            <button type="button" onClick={() => toModel(parts)}>
              {t('readDocumentDialog.useGemini')}
            </button>
            <button type="button" onClick={() => setStage({ s: 'pick' })}>
              {t('readDocumentDialog.back')}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <label className="field">
            {t('readDocumentDialog.whatIsIt')}
            <select value={hint} onChange={(e) => setHint(e.target.value as DocumentHint)}>
              {DOCUMENT_HINTS.map((h) => (
                <option key={h} value={h}>
                  {t(`readDocumentDialog.hint.${h}`)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">{t(lab ? 'readDocumentDialog.labIntro' : 'readDocumentDialog.pickIntro')}</p>
          <label className="field">
            {t('readDocumentDialog.pages')}
            <input
              type="file"
              accept={lab ? ACCEPT_LAB : ACCEPT}
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          {lab && (
            <label className="field mt-3">
              {t('readDocumentDialog.pasteLabel')}
              <textarea
                rows={6}
                value={pasted}
                placeholder={t('readDocumentDialog.pastePlaceholder')}
                onChange={(e) => setPasted(e.target.value)}
              />
            </label>
          )}
          {tooBig && (
            <p className="danger">
              {t('readDocumentDialog.tooBig', {
                mb: (pickedBytes / 1024 / 1024).toFixed(1),
                max: MAX_BYTES / 1024 / 1024,
              })}
            </p>
          )}
          {stage.s === 'error' && (
            <p className="danger">{t('readDocumentDialog.failed', { message: stage.message })}</p>
          )}
          <div className="row mt-3">
            <button
              type="button"
              className="primary"
              disabled={(files.length === 0 && !(lab && pasted.trim())) || tooBig || stage.s === 'reading'}
              onClick={next}
            >
              {stage.s === 'reading'
                ? t('readDocumentDialog.readingLocally')
                : t('readDocumentDialog.continue')}
            </button>
            {close}
          </div>
        </div>
      )}
    </dialog>
  )
}
