import { useRef, useState } from 'react'
import { ACCEPT, checkFile, MAX_PER_ENTRY, type Rejection, sniffMime } from '../attachments/file'
import { megabytes } from '../attachments/quota'
import { useT } from '../i18n/context'

/**
 * Picks the original documents to keep with an entry. Files are checked against their own bytes
 * here, before the entry is saved, so a refusal is something the user can still act on.
 */
export function AttachmentPicker({
  files,
  onChange,
  disabled,
  notice,
}: {
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
  notice?: string
}) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [rejected, setRejected] = useState<{ name: string; why: Rejection }[]>([])

  const add = async (picked: FileList | null) => {
    if (!picked) return
    const kept = [...files]
    const bad: { name: string; why: Rejection }[] = []
    for (const f of Array.from(picked)) {
      const head = new Uint8Array(await f.slice(0, 16).arrayBuffer())
      const why = checkFile(f, sniffMime(head), kept.length)
      if (why) bad.push({ name: f.name, why })
      else kept.push(f)
    }
    setRejected(bad)
    onChange(kept)
    if (input.current) input.current.value = ''
  }

  const message = (r: { name: string; why: Rejection }) =>
    r.why === 'size'
      ? t('attachments.tooBig', { name: r.name, max: megabytes(25 * 1024 * 1024) })
      : r.why === 'count'
        ? t('attachments.tooMany', { max: MAX_PER_ENTRY })
        : r.why === 'space'
          ? t('attachments.noSpace')
          : t('attachments.badType', { name: r.name })

  return (
    <div className="field" style={{ marginTop: '0.6rem' }}>
      <span>{t('attachments.add')}</span>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        disabled={disabled}
        onChange={(e) => void add(e.target.files)}
      />
      <p className="muted">{notice ?? t('attachments.addHint')}</p>
      {files.length > 0 && (
        <div className="row">
          {files.map((f, i) => (
            <span key={`${f.name}-${f.size}-${f.lastModified}`} className="badge">
              {f.name} · {megabytes(f.size)} MB
              <button
                type="button"
                className="small"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                {t('attachments.remove')}
              </button>
            </span>
          ))}
        </div>
      )}
      {rejected.map((r) => (
        <p key={`${r.name}-${r.why}`} className="muted">
          {message(r)}
        </p>
      ))}
    </div>
  )
}
