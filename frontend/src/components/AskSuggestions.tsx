import { type Intent, TEMPLATE_FOR } from '../ask/intent'
import { type AskData, itemLabel, resolve } from '../ask/items'
import { PROMPTS } from '../ask/prompts'
import type { ItemKey, Reason, Suggestion } from '../ask/recommend'
import { useT } from '../i18n/context'
import type { Person } from '../types'

/**
 * What Hearth makes of the question: its type (with the words that gave it away), the prompt
 * template that fits, people named in it who are not selected yet, and records worth including,
 * each with the reason. Nothing is added until the user says so.
 */
export function AskSuggestions({
  intents,
  templateId,
  onTemplate,
  mentioned,
  onSelectPerson,
  suggestions,
  data,
  people,
  included,
  onToggle,
}: {
  intents: Intent[]
  templateId: string
  onTemplate: (id: string) => void
  /** People named in the question but not selected. */
  mentioned: Person[]
  onSelectPerson: (id: string) => void
  suggestions: Suggestion[]
  data: AskData
  people: Person[]
  included: Set<ItemKey>
  onToggle: (key: ItemKey) => void
}) {
  const t = useT()
  const reason = (r: Reason) =>
    r.why === 'recent'
      ? t('askPage.reason.recent', { kind: t(`kind.${r.kind}`) })
      : r.why === 'mentioned' || r.why === 'matchesQuestion'
        ? t(`askPage.reason.${r.why}`, { term: r.term })
        : t(`askPage.reason.${r.why}`)
  const pending = suggestions.filter((s) => !included.has(s.key))
  const recommended = intents[0] && PROMPTS.find((p) => p.id === TEMPLATE_FOR[intents[0].type])

  return (
    <div className="card">
      <h2>{t('askPage.suggestHeading')}</h2>
      {intents.length === 0 ? (
        <p className="muted">{t('askPage.noIntent')}</p>
      ) : (
        <>
          <div className="row">
            {intents.map((i, n) => (
              <span
                key={i.type}
                className={`badge intent${n === 0 ? ' primary' : ''}`}
                title={i.signals.join(', ')}
              >
                {t(`askPage.type.${i.type}`)}
              </span>
            ))}
          </div>
          <p className="muted">
            {t(`askPage.typeHint.${intents[0].type}`)}{' '}
            {t('askPage.signals', { words: intents[0].signals.map((w) => `“${w}”`).join(', ') })}
          </p>
          {recommended && recommended.id !== templateId && (
            <p>
              {t('askPage.templateSuggested', { title: t(recommended.titleKey) })}{' '}
              <button type="button" className="small" onClick={() => onTemplate(recommended.id)}>
                {t('askPage.useTemplate')}
              </button>
            </p>
          )}
        </>
      )}
      {mentioned.length > 0 && (
        <p>
          {t('askPage.mentionedPeople')}{' '}
          {mentioned.map((p) => (
            <button key={p.id} type="button" className="small" onClick={() => onSelectPerson(p.id)}>
              + {p.displayName}
            </button>
          ))}
        </p>
      )}
      {people.length === 0 ? (
        <p className="muted">{t('askPage.pickPeople')}</p>
      ) : suggestions.length === 0 ? (
        intents.length > 0 && <p className="muted">{t('askPage.noSuggestions')}</p>
      ) : (
        <>
          <div className="row">
            <h3 className="m-0">{t('askPage.suggestedRecords', { n: suggestions.length })}</h3>
            {pending.length > 0 && (
              <button
                type="button"
                className="small primary"
                onClick={() => {
                  for (const s of pending) onToggle(s.key)
                }}
              >
                {t('askPage.includeAll', { n: pending.length })}
              </button>
            )}
          </div>
          <ul className="picklist">
            {suggestions.map((s) => {
              const r = resolve(s.key, data)
              if (!r) return null
              const on = included.has(s.key)
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    className={`small${on ? ' active' : ''}`}
                    onClick={() => onToggle(s.key)}
                  >
                    {on ? t('askPage.included') : t('askPage.include')}
                  </button>
                  <span>
                    {people.length > 1 && (
                      <strong>{people.find((p) => p.id === s.personId)?.displayName} · </strong>
                    )}
                    {itemLabel(r, t('askPage.undescribed'))}{' '}
                    <span className="muted">— {reason(s.reason)}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
