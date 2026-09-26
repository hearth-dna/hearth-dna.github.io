import { useApp } from '../app/context'
import { useI18n, useT } from '../i18n/context'
import { conditionById, conditionName } from '../kb/conditions'

/**
 * Which conditions (kb ids) a health-log entry belongs to. Linked ones are chips with ×; the
 * suggested ones are "+ name" chips that link on one click; any other condition can be added from
 * the list. Nothing is linked without a click.
 */
export function ConditionPicker({
  value,
  suggestions,
  onChange,
}: {
  value: string[]
  suggestions: string[]
  onChange: (ids: string[]) => void
}) {
  const { kb } = useApp()
  const { lang } = useI18n()
  const t = useT()
  const name = (id: string) => {
    const c = conditionById(kb, id)
    return c ? conditionName(c, lang) : id
  }
  const offered = suggestions.filter((id) => !value.includes(id))
  const others = kb.conditions
    .filter((c) => !value.includes(c.id))
    .map((c) => ({ id: c.id, name: conditionName(c, lang) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang))

  return (
    <div className="field conditions">
      {t('healthLog.conditions')}
      <div className="row inline">
        {value.map((id) => (
          <button
            key={id}
            type="button"
            className="tag condition active"
            title={t('healthLog.unlinkCondition')}
            onClick={() => onChange(value.filter((v) => v !== id))}
          >
            {name(id)} ×
          </button>
        ))}
        {offered.length > 0 && <span className="muted">{t('healthLog.conditionsSuggested')}</span>}
        {offered.map((id) => (
          <button key={id} type="button" className="tag condition" onClick={() => onChange([...value, id])}>
            + {name(id)}
          </button>
        ))}
        <select
          aria-label={t('healthLog.addCondition')}
          value=""
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        >
          <option value="">{t('healthLog.addCondition')}</option>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
