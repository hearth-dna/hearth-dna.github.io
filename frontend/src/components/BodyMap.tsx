import { useEffect, useState } from 'react'
import { type BodyHeat, bodyKey, HEAT_STEPS, heatLevel, regionCount } from '../health/body'
import { useT } from '../i18n/context'
import { BODY_PARTS, type BodySide } from '../types'
import { bodyOf, type Figure, H, MID, W } from './bodyFigure'
import { STAGES, type Stage } from './bodyWarp'
import { ToothHeat } from './ToothChart'

const FIGURES: Figure[] = ['male', 'female']
const VIEWS = ['front', 'back'] as const

/** The legend's colour steps, 1 to HEAT_STEPS. */
const STEPS = Array.from({ length: HEAT_STEPS }, (_, i) => i + 1)

const DRAWN = new Set(bodyOf('male', 'adult').regions.map((x) => x.part))

/** Parts the log names that have no place on the figure: skin, joints, whole body, typed ones. */
export const elsewhere = (heat: BodyHeat) => [...heat.parts.keys()].filter((k) => !DRAWN.has(k)).sort()

/**
 * Where to look for a picked part: its regions on the front figure where it has any (on the back
 * only for the back), one side only when a side is picked. A small part is shown with what is
 * around it, at most five times larger.
 */
function zoomOn(figure: Figure, stage: Stage, part: string, side: BodySide): string | undefined {
  const all = bodyOf(figure, stage).regions.filter((x) => x.part === part && (!side || x.side === side))
  const view = all.some((x) => x.view === 'front') ? 'front' : 'back'
  const boxes = all.filter((x) => x.view === view).map((x) => x.box)
  if (!boxes.length) return undefined
  const [x0, y0, x1, y1] = [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ]
  const s = Math.min(5, W / (x1 - x0 + 240), H / (y1 - y0 + 240))
  return `translate(${W / 2}px, ${H / 2}px) scale(${s}) translate(${-(x0 + x1) / 2}px, ${-(y0 + y1) / 2}px)`
}

/**
 * The health log on a body, front and back: each part (each side of a paired one) coloured by how
 * many of the shown entries name it. Picking a part zooms in on it and filters the log to it;
 * picking it again, or zooming out, shows the whole body. Parts with no place on the figure (skin,
 * whole body, anything typed) are buttons below it. A male or a female body, starting from the
 * person's recorded sex.
 */
export function BodyMap({
  heat,
  part,
  side,
  figure: initialFigure,
  stage: initialStage,
  teeth,
  tooth,
  onPick,
  onTooth,
}: {
  heat: BodyHeat
  /** Male or female, and the age group, of the person shown; either can be switched. */
  figure: Figure
  stage: Stage
  /** The picked part (`bodyKey`) and side; '' for none. */
  part: string
  side: BodySide
  onPick: (part: string, side: BodySide) => void
  /** Entries per tooth, shown on the mouth; the tooth picked there, null for none. */
  teeth: Map<number, number>
  tooth: number | null
  onTooth: (tooth: number | null) => void
}) {
  const t = useT()
  const [figure, setFigure] = useState(initialFigure)
  const [stage, setStage] = useState(initialStage)
  useEffect(() => setFigure(initialFigure), [initialFigure])
  useEffect(() => setStage(initialStage), [initialStage])
  const body = bodyOf(figure, stage)
  const child = stage !== 'adult'
  const picked = bodyKey(part)
  const name = (p: string) => ((BODY_PARTS as readonly string[]).includes(p) ? t(`bodyPart.${p}`) : p)
  const label = (p: string, s: BodySide, n: number) =>
    t('bodyMap.region', { part: s ? `${name(p)} · ${t(`side.${s}`)}` : name(p), n })
  const zoom = picked ? zoomOn(figure, stage, picked, side) : undefined
  const pick = (p: string, s: BodySide) => (p === picked && s === side ? onPick('', '') : onPick(p, s))
  const other = elsewhere(heat)
  const level = (n: number) => heatLevel(n, heat.max)
  // The teeth share the body's scale, unless one tooth has more entries than any part.
  const teethMax = Math.max(heat.max, ...teeth.values())
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
        <div className="segmented">
          {FIGURES.map((f) => (
            <button
              key={f}
              type="button"
              className={figure === f ? 'active' : ''}
              aria-pressed={figure === f}
              onClick={() => setFigure(f)}
            >
              {t(child ? `bodyMap.${f === 'male' ? 'boy' : 'girl'}` : `bodyMap.${f}`)}
            </button>
          ))}
        </div>
        <select
          aria-label={t('bodyMap.age')}
          value={stage}
          onChange={(e) => setStage(e.target.value as Stage)}
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`bodyMap.stage.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className={zoom ? 'zoomed' : ''}>
        <title>{t('bodyMap.title')}</title>
        <g className="scene" style={zoom ? { transform: zoom } : undefined}>
          {(['front', 'back'] as const).map((v) => (
            <g key={v} className="figure-label">
              <text x={MID[v]} y={H - 30}>
                {t(`bodyMap.${v}`)}
              </text>
              <text x={MID[v] - 250} y={H - 30} className="side">
                {t(v === 'front' ? 'bodyMap.r' : 'bodyMap.l')}
              </text>
              <text x={MID[v] + 250} y={H - 30} className="side">
                {t(v === 'front' ? 'bodyMap.l' : 'bodyMap.r')}
              </text>
            </g>
          ))}
          {VIEWS.map((v) => (
            <g key={v} transform={body.transform[v]}>
              {body.regions
                .filter((x) => x.view === v)
                .map((x) => {
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
                      {x.pieces.map((p, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: a region's pieces are fixed.
                        <path key={i} d={p.d} className={p.overlay ? 'overlay' : undefined} />
                      ))}
                    </g>
                  )
                })}
            </g>
          ))}
        </g>
      </svg>
      {picked === 'mouth' && (
        <ToothHeat
          counts={teeth}
          picked={tooth}
          milkFirst={stage === 'toddler' || stage === 'young' || [...teeth.keys()].every((n) => n > 50)}
          heat={(n) => heatLevel(n, teethMax)}
          onPick={onTooth}
        />
      )}
      <div className="bodymap-legend muted">
        <span>{t('bodyMap.fewer')}</span>
        {STEPS.map((n) => (
          <span key={n} className={`swatch heat-${n}`} />
        ))}
        <span>{t('bodyMap.more', { n: picked === 'mouth' ? teethMax : heat.max })}</span>
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
