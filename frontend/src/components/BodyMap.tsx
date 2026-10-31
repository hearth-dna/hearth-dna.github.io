import { type BodyHeat, bodyKey, HEAT_STEPS, heatLevel, regionCount } from '../health/body'
import { useT } from '../i18n/context'
import { BODY_PARTS, type BodySide } from '../types'
import { bbox, FW, H, pathOf, REGIONS, W } from './bodyFigure'

const GAP = W - FW * 2

/** The legend's colour steps, 1 to HEAT_STEPS. */
const STEPS = Array.from({ length: HEAT_STEPS }, (_, i) => i + 1)

const DRAWN = new Set(REGIONS.map((x) => x.part))

/** Parts the log names that have no place on the figure: skin, joints, whole body, typed ones. */
export const elsewhere = (heat: BodyHeat) => [...heat.parts.keys()].filter((k) => !DRAWN.has(k)).sort()

/**
 * Where to look for a picked part: its regions on the front figure where it has any (on the back
 * only for the back), one side only when a side is picked. A small part is shown with what is
 * around it, at most four times larger.
 */
function zoomOn(part: string, side: BodySide): string | undefined {
  const all = REGIONS.filter((x) => x.part === part && (!side || x.side === side))
  const view = all.some((x) => x.view === 'front') ? 'front' : 'back'
  const shapes = all.filter((x) => x.view === view).flatMap((x) => x.shapes)
  if (!shapes.length) return undefined
  const b = bbox(shapes)
  const s = Math.min(4, W / (b.x1 - b.x0 + 60), H / (b.y1 - b.y0 + 60))
  return `translate(${W / 2}px, ${H / 2}px) scale(${s}) translate(${-(b.x0 + b.x1) / 2}px, ${-(b.y0 + b.y1) / 2}px)`
}

/**
 * The health log on a body, front and back: each part (each side of a paired one) coloured by how
 * many of the shown entries name it. Picking a part zooms in on it and filters the log to it;
 * picking it again, or zooming out, shows the whole body. Parts with no place on the figure (skin,
 * whole body, anything typed) are buttons below it.
 */
export function BodyMap({
  heat,
  part,
  side,
  onPick,
}: {
  heat: BodyHeat
  /** The picked part (`bodyKey`) and side; '' for none. */
  part: string
  side: BodySide
  onPick: (part: string, side: BodySide) => void
}) {
  const t = useT()
  const picked = bodyKey(part)
  const name = (p: string) => ((BODY_PARTS as readonly string[]).includes(p) ? t(`bodyPart.${p}`) : p)
  const label = (p: string, s: BodySide, n: number) =>
    t('bodyMap.region', { part: s ? `${name(p)} · ${t(`side.${s}`)}` : name(p), n })
  const zoom = picked ? zoomOn(picked, side) : undefined
  const pick = (p: string, s: BodySide) => (p === picked && s === side ? onPick('', '') : onPick(p, s))
  const other = elsewhere(heat)
  const level = (n: number) => heatLevel(n, heat.max)
  return (
    <div className="bodymap">
      <div className="bodymap-head">
        <span className="muted">
          {picked ? label(picked, side, regionCount(heat, picked, side)) : t('bodyMap.hint')}
        </span>
        {picked && (
          <button type="button" className="small" onClick={() => onPick('', '')}>
            {t('bodyMap.zoomOut')}
          </button>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className={zoom ? 'zoomed' : ''}>
        <title>{t('bodyMap.title')}</title>
        <g className="scene" style={zoom ? { transform: zoom } : undefined}>
          {(['front', 'back'] as const).map((v, i) => (
            <g key={v} className="figure-label">
              <text x={i * (FW + GAP) + FW / 2} y={H - 4}>
                {t(`bodyMap.${v}`)}
              </text>
              <text x={i * (FW + GAP) + 24} y={H - 4} className="side">
                {t(v === 'front' ? 'bodyMap.r' : 'bodyMap.l')}
              </text>
              <text x={i * (FW + GAP) + FW - 24} y={H - 4} className="side">
                {t(v === 'front' ? 'bodyMap.l' : 'bodyMap.r')}
              </text>
            </g>
          ))}
          {REGIONS.map((x) => {
            const n = regionCount(heat, x.part, x.side)
            const on = x.part === picked && (!side || !x.side || x.side === side)
            const text = label(x.part, x.side, n)
            return (
              // biome-ignore lint/a11y/useSemanticElements: an HTML button cannot sit inside the SVG figure.
              <g
                key={`${x.view}-${x.part}-${x.side}`}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={text}
                className={`region heat-${level(n)}${on ? ' on' : ''}`}
                onClick={() => pick(x.part, x.side)}
                onKeyDown={(ev) => {
                  if (ev.key !== 'Enter' && ev.key !== ' ') return
                  ev.preventDefault()
                  pick(x.part, x.side)
                }}
              >
                <title>{text}</title>
                {x.shapes.map((sh, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a region's shapes are fixed.
                  <path key={i} d={pathOf(sh)} className={sh.overlay ? 'overlay' : undefined} />
                ))}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="bodymap-legend muted">
        <span>{t('bodyMap.fewer')}</span>
        {STEPS.map((n) => (
          <span key={n} className={`swatch heat-${n}`} />
        ))}
        <span>{t('bodyMap.more', { n: heat.max })}</span>
      </div>
      {other.length > 0 && (
        <div className="row bodymap-other">
          <span className="muted">{t('bodyMap.elsewhere')}</span>
          {other.map((p) => (
            <button
              key={p}
              type="button"
              className={`tag${p === picked ? ' active' : ''}`}
              aria-pressed={p === picked}
              onClick={() => pick(p, '')}
            >
              <span className={`swatch heat-${level(heat.parts.get(p) ?? 0)}`} />
              {name(p)} <span className="muted">{heat.parts.get(p)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
