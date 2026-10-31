import { useState } from 'react'
import {
  formatTeeth,
  isMilkTooth,
  MILK_TEETH,
  PERMANENT_TEETH,
  parseTeeth,
  splitTeeth,
  toggleTooth,
  toothType,
} from '../health/teeth'
import { useT } from '../i18n/context'

/** Relative width of a tooth along the arch, by its place from the midline (index 1–8). */
const WIDTH = [0, 1, 0.95, 1, 1, 1, 1.3, 1.25, 1.2]
const MILK_WIDTH = [0, 1, 0.95, 1, 1.15, 1.3]

const W = 320
const H = 350

interface Spot {
  n: number
  x: number
  y: number
  angle: number
  size: number
}

/**
 * Teeth of one jaw laid out on a half ellipse, the person's right on the viewer's left. `up`: the
 * upper jaw, front teeth at the top; else the lower jaw, front teeth at the bottom.
 */
function arch(teeth: number[], up: boolean, milk: boolean): Spot[] {
  const widths = teeth.map((n) => (milk ? MILK_WIDTH : WIDTH)[n % 10])
  const total = widths.reduce((a, b) => a + b, 0)
  const rx = milk ? 100 : 124
  const ry = milk ? 112 : 132
  // A gap between the jaws, so the back teeth of one never touch the other's.
  const cy = up ? H / 2 - 18 : H / 2 + 18
  const start = 0.04
  const span = Math.PI - 2 * start
  const unit = (span * Math.hypot(rx, ry)) / Math.SQRT2 / total
  let at = 0
  return teeth.map((n, i) => {
    const phi = start + (span * (at + widths[i] / 2)) / total
    at += widths[i]
    const x = W / 2 - rx * Math.cos(phi)
    const y = cy + (up ? -1 : 1) * ry * Math.sin(phi)
    // Along the arch's tangent, so each tooth faces the middle of the mouth.
    const angle = (Math.atan2((up ? -1 : 1) * ry * Math.cos(phi), rx * Math.sin(phi)) * 180) / Math.PI
    return { n, x, y, angle, size: unit * widths[i] * 0.47 }
  })
}

const LAYOUT = {
  permanent: [...arch(PERMANENT_TEETH[0], true, false), ...arch(PERMANENT_TEETH[1], false, false)],
  milk: [...arch(MILK_TEETH[0], true, true), ...arch(MILK_TEETH[1], false, true)],
}

/**
 * Pick the teeth an entry is about on a chart of both jaws, numbered the FDI way. Permanent and
 * milk teeth are separate charts with their own numbers, so a child's mixed teeth can be told
 * apart; what is picked on either stays picked when switching. Stored as health/teeth.ts says.
 */
export function ToothChart({
  label,
  value,
  milkFirst,
  onChange,
}: {
  label: string
  value: string | undefined
  /** Open on the milk teeth (teething), unless only permanent ones are picked already. */
  milkFirst?: boolean
  onChange: (next: string | undefined) => void
}) {
  const t = useT()
  const picked = parseTeeth(value)
  const { permanent, milk } = splitTeeth(value)
  const [showMilk, setShowMilk] = useState(
    milk.length > 0 ? permanent.length === 0 || !!milkFirst : !!milkFirst && permanent.length === 0,
  )
  const toggle = (n: number) => onChange(formatTeeth(toggleTooth(picked, n)))
  const name = (n: number) =>
    t(isMilkTooth(n) ? 'detail.teeth.milkTooth' : 'detail.teeth.tooth', {
      n,
      type: t(`detail.teeth.${toothType(n)}`),
    })
  return (
    <fieldset className="field toothchart">
      <legend>{label}</legend>
      <div className="row inline">
        <div className="segmented">
          <button
            type="button"
            className={showMilk ? '' : 'active'}
            aria-pressed={!showMilk}
            onClick={() => setShowMilk(false)}
          >
            {t('detail.teeth.permanent')}
          </button>
          <button
            type="button"
            className={showMilk ? 'active' : ''}
            aria-pressed={showMilk}
            onClick={() => setShowMilk(true)}
          >
            {t('detail.teeth.milk')}
          </button>
        </div>
        {picked.length > 0 && (
          <button type="button" className="small" onClick={() => onChange(undefined)}>
            {t('detail.teeth.clear')}
          </button>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`}>
        <title>{label}</title>
        <text x={W / 2} y={H / 2 - 30} className="jaw">
          {t('detail.teeth.upper')}
        </text>
        <text x={W / 2} y={H / 2 + 40} className="jaw">
          {t('detail.teeth.lower')}
        </text>
        <text x={W / 2 - 70} y={H / 2 + 5} className="jaw side start">
          ← {t('detail.teeth.right')}
        </text>
        <text x={W / 2 + 70} y={H / 2 + 5} className="jaw side end">
          {t('detail.teeth.left')} →
        </text>
        {LAYOUT[showMilk ? 'milk' : 'permanent'].map((s) => {
          const on = picked.includes(s.n)
          return (
            // biome-ignore lint/a11y/useSemanticElements: an HTML button cannot sit inside the SVG chart.
            <g
              key={s.n}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={name(s.n)}
              className={`tooth${on ? ' on' : ''}`}
              onClick={() => toggle(s.n)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                toggle(s.n)
              }}
            >
              <title>{name(s.n)}</title>
              <rect
                x={s.x - s.size}
                y={s.y - s.size * 0.95}
                width={s.size * 2}
                height={s.size * 1.9}
                rx={s.size * 0.6}
                transform={`rotate(${s.angle} ${s.x} ${s.y})`}
              />
              <text x={s.x} y={s.y + 3.5}>
                {s.n}
              </text>
            </g>
          )
        })}
      </svg>
      <span className="muted">
        {picked.length
          ? [
              permanent.length ? t('detail.teethShort', { list: permanent.join(', ') }) : '',
              milk.length ? t('detail.milkShort', { list: milk.join(', ') }) : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : t('detail.teeth.hint')}
      </span>
    </fieldset>
  )
}
