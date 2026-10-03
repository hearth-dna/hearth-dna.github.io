import { useState } from 'react'
import { useApp } from '../app/context'
import { ASSISTANTS, type Assistant, assistantUrl } from '../ask/assistants'
import { logSharing, newId, now } from '../db/repo'
import { rich, useT } from '../i18n/context'
import type { Person } from '../types'

type Destination = 'clipboard' | 'share' | Assistant['id']

/**
 * The context pack as it will leave the device: the exact text, then copy it, hand it to the
 * system share sheet where the browser has one, or open an assistant with it already typed in.
 * Every copy, share or link is confirmed first and recorded in the sharing log and chat history.
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

  const assistant = ASSISTANTS.find((a) => a.id === confirming)
  const links = ASSISTANTS.map((a) => ({ a, url: assistantUrl(a, pack) }))
  const named = (d: Destination) => ASSISTANTS.find((a) => a.id === d)?.name

  const send = async (destination: Destination) => {
    setConfirming(null)
    try {
      if (destination === 'share') await navigator.share({ text: pack })
      else if (destination === 'clipboard') await navigator.clipboard.writeText(pack)
      // An assistant: the confirming link itself opens it.
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
            {done === 'share'
              ? t('askPage.shared')
              : done === 'clipboard'
                ? t('askPage.copied', { destination: done })
                : t('askPage.opened', { assistant: named(done) ?? done })}
          </span>
        )}
      </div>
      <div className="row mt-3">
        <span>{t('askPage.openIn')}</span>
        {links.map(({ a, url }) => (
          <button
            key={a.id}
            type="button"
            className="small"
            disabled={people.length === 0 || !url}
            onClick={() => setConfirming(a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>
      {people.length > 0 && links.some((l) => !l.url) && (
        <p className="muted">{t('askPage.tooLong', { chars: stats.chars.toLocaleString() })}</p>
      )}
      <p className="muted">{t('askPage.trainingNotice')}</p>

      {confirming && (
        <dialog open>
          <h2 className="mt-0">{t('askPage.confirmTitle')}</h2>
          <p>
            {assistant
              ? rich(t('askPage.confirmLinkBody', { assistant: assistant.name }))
              : rich(t(confirming === 'share' ? 'askPage.confirmShareBody' : 'askPage.confirmBody'))}
          </p>
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
            {assistant ? (
              <a
                className="btn primary"
                href={assistantUrl(assistant, pack) ?? undefined}
                target="_blank"
                rel="noreferrer"
                onClick={() => send(assistant.id)}
              >
                {t('askPage.confirmOpen', { assistant: assistant.name })}
              </a>
            ) : (
              <button type="button" className="primary" onClick={() => send(confirming)}>
                {t(confirming === 'share' ? 'askPage.confirmShare' : 'askPage.confirmCopy')}
              </button>
            )}
            <button type="button" onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </dialog>
      )}
    </div>
  )
}
