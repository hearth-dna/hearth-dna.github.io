import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { isThumbnailable } from '../attachments/file'
import { megabytes } from '../attachments/quota'
import { attachmentBytes } from '../attachments/store'
import { useT } from '../i18n/context'
import type { Attachment } from '../types'

/**
 * The documents kept with one entry, rendered while its row is expanded.
 *
 * Bytes are read only while the row is open and every object URL is revoked on the way out, so a
 * long log never holds more than the one row the user is looking at. Documents open in a new tab
 * rather than an inline frame: the page's CSP has no frame-src, and widening it for a preview is
 * not worth the exposure.
 */
export function AttachmentList({
  items,
  onDelete,
}: {
  items: Attachment[]
  onDelete: (a: Attachment) => void
}) {
  const { db } = useApp()
  const t = useT()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [missing, setMissing] = useState<Set<string>>(new Set())

  useEffect(() => {
    let live = true
    const made: string[] = []
    setUrls({})
    setMissing(new Set())
    ;(async () => {
      for (const a of items) {
        const bytes = await attachmentBytes(db, a)
        if (!live) break
        if (!bytes) {
          setMissing((m) => new Set(m).add(a.id))
          continue
        }
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.mime }))
        made.push(url)
        setUrls((m) => ({ ...m, [a.id]: url }))
      }
    })()
    return () => {
      live = false
      for (const url of made) URL.revokeObjectURL(url)
    }
  }, [db, items])

  if (items.length === 0) return null

  return (
    <div className="row attachments">
      {items.map((a) => {
        const url = urls[a.id]
        const gone = missing.has(a.id)
        return (
          <span key={a.id} className="badge" title={`${a.name} · ${megabytes(a.bytes)} MB`}>
            {url && isThumbnailable(a.mime) && (
              <img className="thumb" src={url} alt={a.name} width={48} height={48} />
            )}
            {url ? (
              <a href={url} target="_blank" rel="noopener" download={a.name}>
                {a.name}
              </a>
            ) : (
              <span className="muted">
                {a.name}
                {gone && ` · ${t('attachments.missingBytes')}`}
              </span>
            )}
            <button type="button" className="small danger" onClick={() => onDelete(a)}>
              {t('common.delete')}
            </button>
          </span>
        )
      })}
    </div>
  )
}
