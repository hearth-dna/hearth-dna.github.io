import { useApp } from '../app/context'
import { layoutPedigree } from '../family/inheritance'
import { useT } from '../i18n/context'
import type { Sex } from '../types'
import { NODE_H, NODE_W, Pedigree, pedigreeEdges } from './Pedigree'

/** Pedigree convention: squares for men, circles (here pills) for women, rounded boxes otherwise. */
const CORNER: Record<Sex, number> = { male: 4, female: NODE_H / 2, unknown: 8 }

/** Everyone as a pedigree: one box per person, a line from each parent to each child. */
export function FamilyTree({ onOpen }: { onOpen: (id: string) => void }) {
  const { persons, counts, relationships } = useApp()
  const t = useT()
  const nodes = layoutPedigree(persons, relationships)
  return (
    <>
      <Pedigree
        nodes={nodes}
        edges={pedigreeEdges(nodes)}
        ariaLabel={t('peoplePage.treeAria')}
        node={({ person: p }) => {
          const n = counts[p.id]
          const meta = [
            p.birthYear ? t('peoplePage.born', { year: p.birthYear }) : null,
            n ? t('peoplePage.snps', { n: n.toLocaleString() }) : t('peoplePage.noGenotypes'),
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            // biome-ignore lint/a11y/useSemanticElements: SVG has no button element
            <g
              role="button"
              aria-disabled={!n}
              tabIndex={n ? 0 : -1}
              style={{ cursor: n ? 'pointer' : undefined }}
              onClick={() => n && onOpen(p.id)}
              onKeyDown={(e) => n && (e.key === 'Enter' || e.key === ' ') && onOpen(p.id)}
            >
              {n && <title>{t('peoplePage.report')}</title>}
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={CORNER[p.sex]}
                fill="var(--card)"
                stroke={n ? 'var(--accent)' : 'var(--line)'}
                strokeWidth={n ? 1.5 : 1}
              />
              <text x={NODE_W / 2} y={24} textAnchor="middle" fill="var(--fg)" fontWeight={600}>
                {p.displayName}
              </text>
              <text x={NODE_W / 2} y={44} textAnchor="middle" fill="var(--muted)" fontSize={11}>
                {meta}
              </text>
            </g>
          )
        }}
      />
      {persons.length > 1 && relationships.length === 0 && (
        <p className="muted">{t('peoplePage.treeHint')}</p>
      )}
    </>
  )
}
