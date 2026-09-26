import { useEffect, useMemo, useRef, useState } from 'react'
import { niceTicks, type Panel, type Point } from '../charts/series'
import { formatValue } from '../health/log'
import { useI18n, useT } from '../i18n/context'

const HEIGHT = 190
const M = { top: 10, bottom: 24, left: 46 }
const LABEL_GAP = 14

export interface ChartSeries {
  personId: string
  name: string
  /** CSS colour (a --series-N token). */
  colour: string
}

/** Date ticks at day or month boundaries, about six across the domain. */
function dateTicks(from: number, to: number): number[] {
  const days = (to - from) / 86_400_000
  const out: number[] = []
  if (days <= 62) {
    const step = Math.max(1, Math.ceil(days / 6))
    const d = new Date(from)
    d.setHours(0, 0, 0, 0)
    for (d.setDate(d.getDate() + 1); d.getTime() <= to; d.setDate(d.getDate() + step)) out.push(d.getTime())
  } else {
    const step = Math.max(1, Math.ceil(days / 30.4 / 6))
    const d = new Date(from)
    d.setHours(0, 0, 0, 0)
    d.setDate(1)
    for (d.setMonth(d.getMonth() + 1); d.getTime() <= to; d.setMonth(d.getMonth() + step))
      out.push(d.getTime())
  }
  return out
}

/**
 * One metric over time, one line per person, on the page's shared time domain. Hand-drawn SVG:
 * 2px lines, 8px markers with a surface ring, a ring around out-of-range readings, the printed
 * reference range as a band when every reading shares it, direct labels at the line ends for up
 * to four people, a crosshair tooltip (pointer or arrow keys), and a table view of the same data.
 */
export function TimeChart({
  panel,
  series,
  title,
  domain,
}: {
  panel: Panel
  series: ChartSeries[]
  title: string
  domain: [number, number]
}) {
  const t = useT()
  const { lang } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const byPerson = new Map(series.map((s) => [s.personId, s]))
  const lines = panel.series.filter((s) => byPerson.has(s.personId))
  const labelled = lines.length <= 4
  const right = labelled ? 96 : 12
  const [x0, x1] = domain
  const values = lines.flatMap((s) => s.points.map((p) => p.value))
  const bandValues = [panel.band?.low, panel.band?.high].filter((v): v is number => v != null)
  let lo = Math.min(...values, ...bandValues)
  let hi = Math.max(...values, ...bandValues)
  const pad = hi > lo ? (hi - lo) * 0.08 : Math.abs(hi) * 0.1 || 1
  lo -= pad
  hi += pad
  const w = width - M.left - right
  const h = HEIGHT - M.top - M.bottom
  const x = (v: number) => M.left + (x1 > x0 ? ((v - x0) / (x1 - x0)) * w : w / 2)
  const y = (v: number) => M.top + h - ((v - lo) / (hi - lo)) * h
  const yTicks = niceTicks(lo, hi, 4).filter((v) => v >= lo && v <= hi)
  const xTicks = dateTicks(x0, x1)
  const long = x1 - x0 > 400 * 86_400_000
  const fmtTick = new Intl.DateTimeFormat(
    lang,
    long ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' },
  )
  const fmtDate = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })
  const fmtNum = (v: number) => Number(v.toPrecision(4)).toLocaleString(lang)

  // Every distinct reading time, for the crosshair and the arrow keys.
  const times = useMemo(
    () => [...new Set(lines.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b),
    [lines],
  )
  const nearest = (s: { points: Point[] }, at: number) =>
    s.points.reduce((a, b) => (Math.abs(b.t - at) < Math.abs(a.t - at) ? b : a))
  const snap = (at: number) => times.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a), times[0])

  // Direct labels at each line's last reading, nudged apart so they never overlap.
  const labels = labelled
    ? lines
        .map((s) => ({ s, y: y(s.points[s.points.length - 1].value) }))
        .sort((a, b) => a.y - b.y)
        .reduce<{ s: (typeof lines)[number]; y: number }[]>((out, l) => {
          const prev = out[out.length - 1]
          out.push({ ...l, y: prev && l.y - prev.y < LABEL_GAP ? prev.y + LABEL_GAP : l.y })
          return out
        }, [])
    : []

  // As printed; a pair (blood pressure) shows the half this panel draws.
  const printed = (p: Point) =>
    p.entry.value2 !== null
      ? `${fmtNum(p.value)} ${panel.unit}`
      : formatValue(p.entry) || `${fmtNum(p.value)} ${panel.unit}`
  const converted = (p: Point) =>
    p.entry.unit && p.entry.unit !== panel.unit && p.entry.value2 === null
      ? ` = ${fmtNum(p.value)} ${panel.unit}`
      : ''

  const spoken = (at: number) =>
    [
      fmtDate.format(at),
      ...lines.map((s) => {
        const p = nearest(s, at)
        return `${byPerson.get(s.personId)?.name}: ${printed(p)}${p.entry.flag ? ` ${t(p.entry.flag === 'H' ? 'charts.high' : 'charts.low')}` : ''}`
      }),
    ].join(', ')

  return (
    <div className="card chart" ref={box}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 className="m-0 me-auto">
          {title} {panel.unit && <span className="muted">· {panel.unit}</span>}
        </h3>
        <button type="button" className="small" onClick={() => setTable(!table)}>
          {table ? t('charts.showChart') : t('charts.showTable')}
        </button>
      </div>
      {lines.length > 1 && (
        <div className="legend">
          {lines.map((s) => (
            <span key={s.personId}>
              <span className="swatch" style={{ background: byPerson.get(s.personId)?.colour }} />
              {byPerson.get(s.personId)?.name}
            </span>
          ))}
        </div>
      )}
      {table ? (
        <div className="tablewrap">
          <table className="healthtable">
            <thead>
              <tr>
                <th>{t('healthLog.date')}</th>
                {lines.map((s) => (
                  <th key={s.personId}>{byPerson.get(s.personId)?.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((at) => (
                <tr key={at}>
                  <td className="nowrap">{fmtDate.format(at)}</td>
                  {lines.map((s) => {
                    const p = s.points.find((q) => q.t === at)
                    return (
                      <td key={s.personId}>
                        {p ? printed(p) : ''}
                        {p?.entry.flag && ` ${p.entry.flag === 'H' ? '↑' : '↓'}`}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div
            // A slider over the readings: arrow keys move the crosshair and the value is read out.
            role="slider"
            aria-label={t('charts.aria', { title, n: times.length })}
            aria-valuemin={0}
            aria-valuemax={Math.max(0, times.length - 1)}
            aria-valuenow={hover === null ? 0 : times.indexOf(hover)}
            aria-valuetext={hover === null ? t('charts.ariaHint') : spoken(hover)}
            tabIndex={0}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              const at = x0 + ((e.clientX - r.left - M.left) / w) * (x1 - x0)
              setHover(times.length ? snap(at) : null)
            }}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const i = hover === null ? (e.key === 'ArrowLeft' ? times.length : -1) : times.indexOf(hover)
              setHover(times[Math.min(times.length - 1, Math.max(0, i + (e.key === 'ArrowLeft' ? -1 : 1)))])
            }}
          >
            <svg height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
              {panel.band && (
                <rect
                  className="band"
                  x={M.left}
                  width={w}
                  y={y(Math.min(hi, panel.band.high ?? hi))}
                  height={y(Math.max(lo, panel.band.low ?? lo)) - y(Math.min(hi, panel.band.high ?? hi))}
                />
              )}
              <g className="grid axis">
                {yTicks.map((v) => (
                  <g key={v}>
                    <line x1={M.left} x2={M.left + w} y1={y(v)} y2={y(v)} />
                    <text x={M.left - 6} y={y(v) + 4} textAnchor="end">
                      {fmtNum(v)}
                    </text>
                  </g>
                ))}
                {xTicks.map((v) => (
                  <text key={v} x={x(v)} y={HEIGHT - 6} textAnchor="middle">
                    {fmtTick.format(v)}
                  </text>
                ))}
              </g>
              {hover !== null && (
                <line className="cross" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + h} />
              )}
              {lines.map((s) => {
                const colour = byPerson.get(s.personId)?.colour
                return (
                  <g key={s.personId}>
                    {s.points.length > 1 && (
                      <polyline
                        fill="none"
                        stroke={colour}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={s.points.map((p) => `${x(p.t)},${y(p.value)}`).join(' ')}
                      />
                    )}
                    {s.points.map((p) => (
                      <g key={p.entry.id + p.value}>
                        {p.entry.flag && (
                          <circle
                            cx={x(p.t)}
                            cy={y(p.value)}
                            r={7.5}
                            fill="none"
                            stroke="var(--fg)"
                            strokeWidth={1.5}
                          />
                        )}
                        <circle
                          cx={x(p.t)}
                          cy={y(p.value)}
                          r={hover === p.t ? 5.5 : 4}
                          fill={colour}
                          stroke="var(--card)"
                          strokeWidth={2}
                        />
                      </g>
                    ))}
                  </g>
                )
              })}
              {labels.map((l) => (
                <text key={l.s.personId} className="label person" x={M.left + w + 10} y={l.y + 4}>
                  {byPerson.get(l.s.personId)?.name}
                </text>
              ))}
            </svg>
          </div>
          {hover !== null && (
            <div
              className="tip"
              // Right of the crosshair in the left half, left of it in the right half: never off the card.
              style={
                x(hover) < width / 2
                  ? { left: x(hover) + 12, top: 48 }
                  : { right: width - x(hover) + 12, top: 48 }
              }
            >
              <div className="muted">{fmtDate.format(hover)}</div>
              {lines.map((s) => {
                const p = nearest(s, hover)
                return (
                  <div key={s.personId}>
                    <span className="swatch" style={{ background: byPerson.get(s.personId)?.colour }} />
                    {lines.length > 1 && `${byPerson.get(s.personId)?.name}: `}
                    {printed(p)}
                    {converted(p)}
                    {p.entry.flag && ` ${p.entry.flag === 'H' ? '↑' : '↓'}`}
                    {p.t !== hover && <span className="muted"> ({fmtDate.format(p.t)})</span>}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
