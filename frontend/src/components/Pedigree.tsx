import type { ReactNode } from 'react'
import type { PedigreeNode } from '../family/inheritance'

export const NODE_W = 150
export const NODE_H = 62
const GAP_X = 40
const GAP_Y = 90

export interface PedigreeEdge {
  from: PedigreeNode
  to: PedigreeNode
  stroke?: string
  strokeWidth?: number
  dashed?: boolean
  /** Text drawn on the middle of the line, e.g. the allele a parent passed on. */
  label?: ReactNode
  labelColor?: string
}

/**
 * Generation-by-generation SVG of a pedigree: one slot per person, a line from every parent to
 * every child. Callers draw the box content and style the edges; this only owns the geometry so
 * the family tree and the per-rsid inheritance tree line up the same way.
 */
export function Pedigree({
  nodes,
  edges,
  node,
  ariaLabel,
}: {
  nodes: PedigreeNode[]
  edges: PedigreeEdge[]
  node: (n: PedigreeNode) => ReactNode
  ariaLabel: string
}) {
  const cols = Math.max(1, ...nodes.map((n) => n.column + 1))
  const rows = Math.max(1, ...nodes.map((n) => n.generation + 1))
  const x = (col: number) => col * (NODE_W + GAP_X) + GAP_X / 2
  const y = (gen: number) => gen * (NODE_H + GAP_Y) + 10
  const width = cols * (NODE_W + GAP_X)
  const height = rows * (NODE_H + GAP_Y) - GAP_Y + 20
  return (
    <div className="tablewrap">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        style={{ maxWidth: '100%', fontFamily: 'inherit', fontSize: 13 }}
      >
        {edges.map((e) => (
          <g key={`${e.from.person.id}-${e.to.person.id}`}>
            <line
              x1={x(e.from.column) + NODE_W / 2}
              y1={y(e.from.generation) + NODE_H}
              x2={x(e.to.column) + NODE_W / 2}
              y2={y(e.to.generation)}
              stroke={e.stroke ?? 'var(--muted)'}
              strokeWidth={e.strokeWidth ?? 1.2}
              strokeDasharray={e.dashed ? '5 4' : undefined}
            />
            {e.label && (
              <text
                x={(x(e.from.column) + x(e.to.column)) / 2 + NODE_W / 2}
                y={(y(e.from.generation) + NODE_H + y(e.to.generation)) / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={e.labelColor ?? 'var(--fg)'}
                fontWeight={700}
                style={{ paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 5 }}
              >
                {e.label}
              </text>
            )}
          </g>
        ))}
        {nodes.map((n) => (
          <g key={n.person.id} transform={`translate(${x(n.column)},${y(n.generation)})`}>
            {node(n)}
          </g>
        ))}
      </svg>
    </div>
  )
}

/** Parent→child pairs of a layout, skipping parents that are not in it. */
export function pedigreeEdges(nodes: PedigreeNode[]): { from: PedigreeNode; to: PedigreeNode }[] {
  const byId = new Map(nodes.map((n) => [n.person.id, n]))
  return nodes.flatMap((to) =>
    to.parents.flatMap((pid) => {
      const from = byId.get(pid)
      return from ? [{ from, to }] : []
    }),
  )
}
