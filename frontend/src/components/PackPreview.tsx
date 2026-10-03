import { useState } from 'react'
import { useApp } from '../app/context'
import { logSharing, newId, now } from '../db/repo'
import { rich, useT } from '../i18n/context'
import type { Person } from '../types'

type Destination = 'clipboard' | 'share'

/**
 * The context pack as it will leave the device: the exact text, then copy (or the system share
 * sheet, where the browser has one, to hand it to an assistant app). Every copy or share is
 * confirmed first and recorded in the sharing log and the chat history.
 */
export function PackPreview({
  pack,
  stats,
  people,
  question,
  realNames,
}: {
  pack: string
  stats: { chars: number; tokens: number; genotypes: number; healthEntries: number }
  /** The people whose records are in the pack. */
  people: Person[]
  question: string
  realNames: boolean
}) {
  const { db } = useApp()
  const t = useT()
  const [confirming, setConfirming] = useState<Destination | null>(null)
  const [done, setDone] = useState<Destination | null>(null)
  const canShare = typeof navigator.share === 'function'

  const send = async (destination: Destination) => {
    setConfirming(null)
    try {
      if (destination === 'share') await navigator.share({ text: pack })
      else await navigator.clipboard.writeText(pack)
    } catch {
      return // share sheet dismissed
    }
    await logSharing(db, 'copy-out', destination, pack)
    await db.exec(
      'INSERT INTO chat(id,person_ids,question,context_pack,tier,created_at) VALUES (?,?,?,?,?,?)',
      [newId(), people.map((p) => p.id).join(','), question, pack, 'copy-out', now()],
    )
    setDone(destination)
  }

  return (
    <div className="card">
      <h2>
        {t('askPage.previewHeading', {
          chars: stats.chars.toLocaleString(),
          tokens: stats.tokens.toLocaleString(),
        })}
      </h2>
      <pre className="pack">{pack}</pre>
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={people.length === 0}
          onClick={() => setConfirming('clipboard')}
        >
          {t('askPage.copyButton')}
        </button>
        {canShare && (
          <button type="button" disabled={people.length === 0} onClick={() => setConfirming('share')}>
            {t('askPage.shareButton')}
          </button>
        )}
        {done && (
          <span className="ok">
            {done === 'share' ? t('askPage.shared') : t('askPage.copied', { destination: done })}
          </span>
        )}
      </div>
      <p className="muted">
        {rich(t('askPage.openAssistant'), {
          chatgpt: (c) => (
            <a href="https://chatgpt.com" target="_blank" rel="noreferrer">
              {c}
            </a>
          ),
          claude: (c) => (
            <a href="https://claude.ai" target="_blank" rel="noreferrer">
              {c}
            </a>
          ),
          gemini: (c) => (
            <a href="https://gemini.google.com" target="_blank" rel="noreferrer">
              {c}
            </a>
          ),
        })}
      </p>

      {confirming && (
        <dialog open>
          <h2 className="mt-0">{t('askPage.confirmTitle')}</h2>
          <p>{rich(t(confirming === 'share' ? 'askPage.confirmShareBody' : 'askPage.confirmBody'))}</p>
          <ul>
            <li>
              {t('askPage.confirmCounts', {
                genotypes: stats.genotypes,
                healthEntries: stats.healthEntries,
                people: people.length,
                peopleWord: people.length === 1 ? t('askPage.person') : t('askPage.peopleWord'),
                naming: realNames ? t('askPage.withRealNames') : t('askPage.pseudonymised'),
              })}
            </li>
            <li>{t('askPage.confirmLogged')}</li>
          </ul>
          <div className="row">
            <button type="button" className="primary" onClick={() => send(confirming)}>
              {t(confirming === 'share' ? 'askPage.confirmShare' : 'askPage.confirmCopy')}
            </button>
            <button type="button" onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </dialog>
      )}
    </div>
  )
}
