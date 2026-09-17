import { useApp } from '../app/context'
import type { FamilyCall } from '../db/repo'
import { alleleOrigins, layoutPedigree } from '../family/inheritance'
import { rich, useT } from '../i18n/context'
import type { KbEntry } from '../kb/kb'
import { NODE_H, NODE_W, Pedigree, type PedigreeEdge, pedigreeEdges } from './Pedigree'

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
  const risk = entry?.risk_allele

  const edges: PedigreeEdge[] = pedigreeEdges(nodes).map(({ from, to }) => {
    const child = callOf.get(to.person.id)
    const origins = child
      ? alleleOrigins(
          child,
          to.parents.map((id) => ({ id, call: callOf.get(id) })),
        )
      : []
    const mine = origins.filter((o) => o.from === from.person.id).map((o) => o.allele)
    const impossible = origins[0]?.from === 'impossible'
    return {
      from,
      to,
      stroke: impossible ? 'var(--danger)' : undefined,
      strokeWidth: mine.length ? 2 : undefined,
      dashed: origins.length > 0 && !impossible && mine.length === 0,
      label: mine.length ? mine.join('') : undefined,
      labelColor: risk && mine.includes(risk) ? 'var(--danger)' : undefined,
    }
  })

  return (
    <>
      <Pedigree
        nodes={nodes}
        edges={edges}
        ariaLabel={t('inheritanceTree.ariaLabel')}
        node={(n) => {
          const c = callOf.get(n.person.id)
          const copies = c && risk ? [c.a1, c.a2].filter((a) => a === risk).length : 0
          const stroke = copies === 2 ? 'var(--danger)' : copies === 1 ? 'var(--warn)' : 'var(--line)'
          return (
            <>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill="var(--card)"
                stroke={stroke}
                strokeWidth={copies ? 2 : 1}
              />
              <text x={NODE_W / 2} y={20} textAnchor="middle" fill="var(--fg)" fontWeight={600}>
                {n.person.displayName}
                {n.person.sex !== 'unknown' ? ` (${n.person.sex[0]})` : ''}
              </text>
              <text
                x={NODE_W / 2}
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
            </>
          )
        }}
      />
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
    </>
  )
}
