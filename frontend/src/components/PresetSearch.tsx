import { useId, useState } from 'react'
import { type HealthPreset, presetNamed, searchPresets } from '../health/presets'

/**
 * A search box over presets that works the same on a phone and a computer: typing filters the
 * list under it (shown name, English title, synonyms), a tap or Enter picks, and text that names
 * no preset stays as typed, a custom entry. Not a `<datalist>`: phone browsers barely show one.
 */
export function PresetSearch({
  presets,
  name,
  value,
  onChange,
  onEnter,
  label,
  placeholder,
}: {
  /** In the order to offer them (recently used first). */
  presets: HealthPreset[]
  /** The name shown for a preset, in the UI language. */
  name: (p: HealthPreset) => string
  value: string
  onChange: (v: string) => void
  /** Enter once nothing is left to pick: the bar saves. */
  onEnter: () => void
  label: string
  placeholder: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  // A picked name lists everything again, so another can be chosen without clearing it first.
  const matches = presetNamed(presets, value, name) ? presets : searchPresets(presets, value, name)
  const shown = open && matches.length > 0

  const pick = (p: HealthPreset) => {
    onChange(name(p))
    setOpen(false)
  }

  return (
    <div className="suggest">
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={shown}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={shown ? `${id}-${active}` : undefined}
        placeholder={placeholder}
        value={value}
        onFocus={(e) => {
          e.target.select()
          setOpen(true)
          setActive(0)
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!shown) return setOpen(true)
            const step = e.key === 'ArrowDown' ? 1 : -1
            setActive((active + step + matches.length) % matches.length)
          } else if (e.key === 'Escape') setOpen(false)
          else if (e.key === 'Enter') {
            if (shown && !presetNamed(presets, value, name)) pick(matches[active] ?? matches[0])
            else onEnter()
          }
        }}
      />
      {shown && (
        <div id={id} role="listbox" className="suggest-list">
          {matches.map((p, i) => (
            <div
              key={p.id}
              id={`${id}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              // Keeps the focus in the box, so the tap lands before the list closes.
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              onKeyDown={(e) => e.key === 'Enter' && pick(p)}
            >
              {name(p)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
