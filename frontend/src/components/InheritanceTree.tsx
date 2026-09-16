import { useApp } from '../app/context'
import type { FamilyCall } from '../db/repo'
import { alleleOrigins, layoutPedigree } from '../family/inheritance'
import { rich, useT } from '../i18n/context'
import type { KbEntry } from '../kb/kb'

const W = 150
const H = 62
const GAP_X = 40
const GAP_Y = 90

/**
 * Pedigree for one rsid: a box per person with their genotype, a line from each parent to each
 * child labelled with the allele that parent passed on. Risk alleles (from the kb entry, if any)
 * are highlighted; ambiguous phases are drawn dashed, Mendelian-impossible ones red.
 */
export function InheritanceTree({ calls, entry }: { calls: FamilyCall[]; entry?: KbEntry }) {
  const { persons, relationships } = useApp()
  const t = useT()
  const nodes = layoutPedigree(persons, relationships)
  const callOf = new Map(calls.map((c) => [c.personId, c]))
  const byId = new Map(nodes.map((n) => [n.person.id, n]))
  const cols = Math.max(1, ...nodes.map((n) => n.column + 1))
  const rows = Math.max(1, ...nodes.map((n) => n.generation + 1))
  const x = (col: number) => col * (W + GAP_X) + GAP_X / 2
  const y = (gen: number) => gen * (H + GAP_Y) + 10
  const width = cols * (W + GAP_X)
  const height = rows * (H + GAP_Y) - GAP_Y + 20
  const risk = entry?.risk_allele

  const edges = nodes.flatMap((n) => {
    const child = callOf.get(n.person.id)
    const origins = child
      ? alleleOrigins(
          child,
          n.parents.map((id) => ({ id, call: callOf.get(id) })),
        )
      : []
    return n.parents.map((pid) => {
      const p = byId.get(pid)
      if (!p) return null
      const mine = origins.filter((o) => o.from === pid).map((o) => o.allele)
      const state =
        origins.length === 0
          ? 'none'
          : origins[0].from === 'impossible'
            ? 'impossible'
            : mine.length
              ? 'phased'
              : 'ambiguous'
      return { from: p, to: n, alleles: mine, state }
    })
  })

  return (
    <div className="tablewrap">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('inheritanceTree.ariaLabel')}
        style={{ maxWidth: '100%', fontFamily: 'inherit', fontSize: 13 }}
      >
        {edges.map((e) =>
          e ? (
            <g key={`${e.from.person.id}-${e.to.person.id}`}>
              <line
                x1={x(e.from.column) + W / 2}
                y1={y(e.from.generation) + H}
                x2={x(e.to.column) + W / 2}
                y2={y(e.to.generation)}
                stroke={e.state === 'impossible' ? 'var(--danger)' : 'var(--muted)'}
                strokeWidth={e.state === 'phased' ? 2 : 1.2}
                strokeDasharray={e.state === 'ambiguous' ? '5 4' : undefined}
              />
              {e.alleles.length > 0 && (
                <text
                  x={(x(e.from.column) + x(e.to.column)) / 2 + W / 2}
                  y={(y(e.from.generation) + H + y(e.to.generation)) / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={risk && e.alleles.includes(risk) ? 'var(--danger)' : 'var(--fg)'}
                  fontWeight={700}
                  style={{ paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 5 }}
                >
                  {e.alleles.join('')}
                </text>
              )}
            </g>
          ) : null,
        )}
        {nodes.map((n) => {
          const c = callOf.get(n.person.id)
          const copies = c && risk ? [c.a1, c.a2].filter((a) => a === risk).length : 0
          const stroke = copies === 2 ? 'var(--danger)' : copies === 1 ? 'var(--warn)' : 'var(--line)'
          return (
            <g key={n.person.id} transform={`translate(${x(n.column)},${y(n.generation)})`}>
              <rect
                width={W}
                height={H}
                rx={8}
                fill="var(--card)"
                stroke={stroke}
                strokeWidth={copies ? 2 : 1}
              />
              <text x={W / 2} y={20} textAnchor="middle" fill="var(--fg)" fontWeight={600}>
                {n.person.displayName}
                {n.person.sex !== 'unknown' ? ` (${n.person.sex[0]})` : ''}
              </text>
              <text
                x={W / 2}
                y={44}
                textAnchor="middle"
                fill={c ? 'var(--fg)' : 'var(--muted)'}
                fontSize={16}
              >
                {c ? (
                  <>
                    <tspan
                      fill={c.a1 === risk ? 'var(--danger)' : undefined}
                      fontWeight={c.a1 === risk ? 700 : 400}
                    >
                      {c.a1}
                    </tspan>
                    <tspan
                      fill={c.a2 === risk ? 'var(--danger)' : undefined}
                      fontWeight={c.a2 === risk ? 700 : 400}
                    >
                      {c.a2}
                    </tspan>
                  </>
                ) : (
                  t('inheritanceTree.notTyped')
                )}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="muted">
        {t('inheritanceTree.legend')}
        {risk && (
          <>
            {' '}
            {rich(t('inheritanceTree.riskLegend', { allele: risk }), {
              r: (c) => <strong className="danger">{c}</strong>,
            })}
          </>
        )}
      </p>
    </div>
  )
}
