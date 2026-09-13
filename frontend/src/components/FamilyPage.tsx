import { useState } from 'react'
import { useApp } from '../app/context'
import { type FamilyCall, familyAt } from '../db/repo'
import { searchKb } from '../kb/kb'
import { InheritanceTree } from './InheritanceTree'

/** The `family_all` view: one rsid across everyone, plus kb search to find rsids by drug/condition. */
export function FamilyPage() {
  const { db, kb, persons, relationships } = useApp()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<FamilyCall[] | null>(null)
  const hits = searchKb(kb, q).slice(0, 12)
  const entry = rows ? kb.entries.find((e) => e.rsid === q) : undefined

  const lookup = async (rsid: string) => {
    setQ(rsid)
    setRows(await familyAt(db, rsid))
  }

  return (
    <div>
      <h1>Family lookup</h1>
      <div className="card">
        <div className="row">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="rs7903146, or a gene, drug or condition"
            style={{ flex: 1, minWidth: '16rem' }}
            onKeyDown={(e) => e.key === 'Enter' && /^rs\d+$/i.test(q.trim()) && lookup(q.trim())}
          />
          <button
            type="button"
            className="primary"
            disabled={!/^rs\d+$/i.test(q.trim())}
            onClick={() => lookup(q.trim())}
          >
            Look up
          </button>
        </div>
        {hits.length > 0 && !/^rs\d+$/i.test(q.trim()) && (
          <ul>
            {hits.map((e) => (
              <li key={e.rsid}>
                <button type="button" onClick={() => lookup(e.rsid)}>
                  {e.rsid}
                </button>{' '}
                {e.gene} — {e.name} <span className="muted">{e.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rows && (
        <div className="card">
          <h2>
            {q}
            {entry && (
              <span className="muted">
                {' '}
                · {entry.gene} — {entry.name}
              </span>
            )}
          </h2>
          {rows.length > 0 && relationships.length > 0 && (
            <>
              <h3>Who inherited what</h3>
              <InheritanceTree calls={rows} entry={entry} />
            </>
          )}
          {rows.length === 0 ? (
            <p className="muted">Not genotyped in any imported file.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Chr</th>
                  <th>Position</th>
                  <th>Genotype</th>
                </tr>
              </thead>
              <tbody>
                {persons.map((p) => {
                  const r = rows.find((x) => x.personId === p.id)
                  return (
                    <tr key={p.id}>
                      <td>{p.displayName}</td>
                      <td>{r?.chromosome ?? '–'}</td>
                      <td>{r?.position ?? '–'}</td>
                      <td>{r ? `${r.a1}/${r.a2}` : <span className="muted">not on chip</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
