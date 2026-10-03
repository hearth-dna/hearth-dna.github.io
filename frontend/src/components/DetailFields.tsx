import type { DetailField, DetailValue } from '../health/presets'
import { useT } from '../i18n/context'

type Details = Record<string, DetailValue>

/**
 * The structured details of one symptom (health/presets.ts `details`): a 1–N scale as buttons,
 * a choice as a select, a yes/no as a checkbox, a count as a number. Everything is optional; an
 * unset field is simply not stored.
 */
export function DetailFields({
  fields,
  value,
  onChange,
}: {
  fields: DetailField[]
  value: Details
  onChange: (next: Details) => void
}) {
  const t = useT()
  const set = (id: string, v: DetailValue | undefined) => {
    const next = { ...value }
    if (v === undefined) delete next[id]
    else next[id] = v
    onChange(next)
  }
  return (
    <>
      {fields.map((f) => {
        const label = t(`detail.${f.id}`)
        if (f.kind === 'scale')
          return (
            <fieldset key={f.id} className="field">
              <legend>{label}</legend>
              <div className="segmented">
                {Array.from({ length: f.max - f.min + 1 }, (_, i) => f.min + i).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={value[f.id] === n ? 'active' : ''}
                    aria-pressed={value[f.id] === n}
                    title={t(`detail.${f.id}.${n}`)}
                    onClick={() => set(f.id, value[f.id] === n ? undefined : n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>
          )
        if (f.kind === 'choice')
          return (
            <label key={f.id} className="field">
              {label}
              <select
                aria-label={label}
                value={typeof value[f.id] === 'string' ? (value[f.id] as string) : ''}
                onChange={(e) => set(f.id, e.target.value || undefined)}
              >
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {t(`detail.${f.id}.${o}`)}
                  </option>
                ))}
              </select>
            </label>
          )
        if (f.kind === 'count')
          return (
            <label key={f.id} className="field">
              {label}
              <input
                aria-label={label}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="narrow"
                value={typeof value[f.id] === 'number' ? String(value[f.id]) : ''}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value))
                  set(f.id, e.target.value && n > 0 ? n : undefined)
                }}
              />
            </label>
          )
        return (
          <label key={f.id} className="check m-0 detailflag">
            <input
              type="checkbox"
              checked={value[f.id] === true}
              onChange={(e) => set(f.id, e.target.checked ? true : undefined)}
            />
            <span>{label}</span>
          </label>
        )
      })}
    </>
  )
}

/** Details as a short translated line for the table: "Type 6 · yellow · blood". */
export function useDetailsText(): (fields: DetailField[] | undefined, d: Details) => string {
  const t = useT()
  return (fields, d) => {
    const known = fields ?? []
    return [...known.map((f) => f.id), ...Object.keys(d).filter((k) => !known.some((f) => f.id === k))]
      .filter((k) => d[k] !== undefined)
      .map((k) => {
        const v = d[k]
        if (k === 'bristol') return t('detail.bristolShort', { n: v as number })
        if (k === 'times') return t('detail.timesShort', { n: v as number })
        if (v === true) return t(`detail.${k}`)
        return typeof v === 'string' ? t(`detail.${k}.${v}`) : `${t(`detail.${k}`)} ${v}`
      })
      .join(' · ')
  }
}
