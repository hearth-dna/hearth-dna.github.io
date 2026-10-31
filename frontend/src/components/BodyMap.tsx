import { type BodyHeat, bodyKey, HEAT_STEPS, heatLevel, PAIRED, regionCount } from '../health/body'
import { useT } from '../i18n/context'
import { BODY_PARTS, type BodySide } from '../types'

type Shape =
  | { e: [number, number, number, number] } // ellipse: cx, cy, rx, ry
  | { r: [number, number, number, number] } // rounded rect: x, y, w, h

interface Region {
  part: string
  side: BodySide
  view: 'front' | 'back'
  shapes: Shape[]
}

/** Figure size; the back figure sits to the right of the front one. */
const FW = 200
const GAP = 30
const W = FW * 2 + GAP
const H = 440

const e = (cx: number, cy: number, rx: number, ry: number): Shape => ({ e: [cx, cy, rx, ry] })
const r = (x: number, y: number, w: number, h: number): Shape => ({ r: [x, y, w, h] })
/** The same shape on the other side of the figure's midline. */
const mirror = (s: Shape): Shape =>
  'e' in s
    ? { e: [FW - s.e[0], s.e[1], s.e[2], s.e[3]] }
    : { r: [FW - s.r[0] - s.r[2], s.r[1], s.r[2], s.r[3]] }
const shift = (s: Shape, dx: number): Shape =>
  'e' in s ? { e: [s.e[0] + dx, s.e[1], s.e[2], s.e[3]] } : { r: [s.r[0] + dx, s.r[1], s.r[2], s.r[3]] }

/**
 * Each part drawn on the viewer's left half of a figure; paired parts are mirrored for the other
 * side. Later parts are drawn over earlier ones (the heart over the chest and lungs).
 */
const LEFT_HALF: [string, Shape[]][] = [
  ['head', [e(100, 40, 24, 30)]],
  ['ears', [e(74, 42, 4, 8)]],
  ['eyes', [e(90, 36, 6, 3.5)]],
  ['nose', [e(100, 46, 3.5, 6)]],
  ['mouth', [e(100, 58, 9, 3.5)]],
  ['neck', [r(90, 68, 20, 20)]],
  ['throat', [e(100, 80, 6, 4.5)]],
  ['shoulders', [e(66, 98, 13, 10)]],
  ['chest', [r(76, 90, 48, 58)]],
  ['back', [r(76, 90, 48, 74)]],
  ['lower back', [r(78, 166, 44, 36)]],
  ['lungs', [e(88, 118, 9, 19)]],
  ['heart', [e(109, 126, 7, 8)]],
  ['abdomen', [r(78, 150, 44, 52)]],
  ['stomach', [e(108, 165, 10, 7)]],
  ['hips', [r(74, 204, 25, 24)]],
  ['arms', [r(50, 104, 13, 54), r(48, 170, 12, 46)]],
  ['elbows', [e(56, 164, 7, 6)]],
  ['wrists', [e(54, 220, 6, 4.5)]],
  ['hands', [e(53, 235, 8, 10)]],
  ['fingers', [r(46, 246, 14, 12)]],
  ['legs', [r(77, 230, 21, 70), r(79, 320, 17, 64)]],
  ['knees', [e(87, 310, 10, 9)]],
  ['ankles', [e(87, 390, 7, 5)]],
  ['feet', [e(85, 403, 13, 7)]],
]

const FRONT_ONLY = new Set([
  'ears',
  'eyes',
  'nose',
  'mouth',
  'throat',
  'chest',
  'lungs',
  'heart',
  'abdomen',
  'stomach',
])
const BACK_ONLY = new Set(['back', 'lower back'])

/**
 * Front: the person faces the viewer, so their right is on the viewer's left. Back: seen from
 * behind, their right is on the viewer's right.
 */
const REGIONS: Region[] = LEFT_HALF.flatMap(([part, shapes]) => {
  const out: Region[] = []
  const add = (view: 'front' | 'back', side: BodySide, ss: Shape[]) =>
    out.push({ part, side, view, shapes: view === 'back' ? ss.map((s) => shift(s, FW + GAP)) : ss })
  for (const view of ['front', 'back'] as const) {
    if ((view === 'front' && BACK_ONLY.has(part)) || (view === 'back' && FRONT_ONLY.has(part))) continue
    if (!PAIRED.has(part)) add(view, '', shapes)
    else {
      add(view, view === 'front' ? 'right' : 'left', shapes)
      add(view, view === 'front' ? 'left' : 'right', shapes.map(mirror))
    }
  }
  return out
})

/** The legend's colour steps, 1 to HEAT_STEPS. */
const STEPS = Array.from({ length: HEAT_STEPS }, (_, i) => i + 1)

const DRAWN = new Set(REGIONS.map((x) => x.part))

/** Parts the log names that have no place on the figure: skin, joints, whole body, typed ones. */
export const elsewhere = (heat: BodyHeat) => [...heat.parts.keys()].filter((k) => !DRAWN.has(k)).sort()

function bbox(shapes: Shape[]) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const s of shapes) {
    const [a, b, c, d] =
      'e' in s
        ? [s.e[0] - s.e[2], s.e[1] - s.e[3], s.e[0] + s.e[2], s.e[1] + s.e[3]]
        : [s.r[0], s.r[1], s.r[0] + s.r[2], s.r[1] + s.r[3]]
    x0 = Math.min(x0, a)
    y0 = Math.min(y0, b)
    x1 = Math.max(x1, c)
    y1 = Math.max(y1, d)
  }
  return { x0, y0, x1, y1 }
}

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

const shapeEl = (s: Shape, i: number) =>
  'e' in s ? (
    <ellipse key={i} cx={s.e[0]} cy={s.e[1]} rx={s.e[2]} ry={s.e[3]} />
  ) : (
    <rect key={i} x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} rx={Math.min(8, s.r[2] / 2)} />
  )

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
                {x.shapes.map(shapeEl)}
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
