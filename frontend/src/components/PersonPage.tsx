import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { listSourceFiles, mendelianSql, personCallsFor } from '../db/repo'
import { computeFindings, type Finding } from '../kb/kb'
import { PROVIDER_LABELS, type SourceFile } from '../types'

export function PersonPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { db, kb, persons, relationships } = useApp()
  const person = persons.find((p) => p.id === id)!
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [files, setFiles] = useState<SourceFile[]>([])
  const [mendel, setMendel] = useState<
    { label: string; compared: number; violations: number; rate: number }[]
  >([])

  useEffect(() => {
    ;(async () => {
      setFiles((await listSourceFiles(db)).filter((f) => f.personId === id))
      const calls = await personCallsFor(
        db,
        id,
        kb.entries.map((e) => e.rsid),
      )
      setFindings(computeFindings(kb, calls))
      const parentIds = relationships.filter((r) => r.childId === id).map((r) => r.parentId)
      const out: { label: string; compared: number; violations: number; rate: number }[] = []
      for (const pid of parentIds) {
        const label = persons.find((p) => p.id === pid)?.displayName ?? pid
        out.push({ label, ...(await mendelianSql(db, id, pid)) })
      }
      if (parentIds.length === 2) {
        out.push({
          label: 'both parents (trio)',
          ...(await mendelianSql(db, id, parentIds[0], parentIds[1])),
        })
      }
      setMendel(out)
    })()
  }, [db, kb, id, persons, relationships])

  const magClass = (m: number) => (m >= 3 ? 'mag hi' : m >= 2 ? 'mag mid' : 'mag')

  return (
    <div>
      <button type="button" onClick={onBack}>
        ← People
      </button>
      <h1>{person.displayName}</h1>
      <div className="card">
        <h2>Sources</h2>
        {files.length === 0 ? (
          <p className="muted">none</p>
        ) : (
          <ul>
            {files.map((f) => (
              <li key={f.id}>
                {PROVIDER_LABELS[f.provider]} · build {f.build} · {f.rowCount.toLocaleString()} calls ·{' '}
                {f.originalName} · sha256 {f.sha256.slice(0, 12)}…
              </li>
            ))}
          </ul>
        )}
        {mendel.length > 0 && (
          <>
            <h3>Mendelian consistency with parents</h3>
            <ul>
              {mendel.map((m) => (
                <li key={m.label}>
                  {m.label}: {m.violations.toLocaleString()} / {m.compared.toLocaleString()} shared SNPs (
                  {(m.rate * 100).toFixed(2)}%){' '}
                  <span className={m.rate < 0.01 ? 'ok' : 'danger'}>
                    {m.rate < 0.01
                      ? 'consistent'
                      : m.rate < 0.03
                        ? 'borderline'
                        : 'inconsistent — likely unrelated or wrong file'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="card">
        <h2>Findings from the knowledge base</h2>
        <p className="muted">
          Informational only. Evidence: A = guideline/replicated, B = replicated association, C = preliminary.
          Strand: forward.
        </p>
        {findings === null ? (
          <p className="muted">computing…</p>
        ) : findings.length === 0 ? (
          <p className="muted">No kb markers found in this file.</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Gene / marker</th>
                  <th>Genotype</th>
                  <th>Meaning</th>
                  <th>Evidence</th>
                  <th>Impact</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => (
                  <tr key={f.entry.rsid}>
                    <td>
                      <strong>{f.entry.gene}</strong>
                      <br />
                      <a
                        href={`https://www.ncbi.nlm.nih.gov/snp/${f.entry.rsid}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {f.entry.rsid}
                      </a>
                      <br />
                      <span className="muted">{f.entry.name}</span>
                    </td>
                    <td>
                      {f.call.a1}/{f.call.a2}
                      <br />
                      <span className="muted">{f.riskCopies} risk copies</span>
                    </td>
                    <td>
                      {f.match?.label ?? <span className="muted">genotype not described</span>}
                      <br />
                      <span className="muted">{f.entry.summary}</span>
                    </td>
                    <td>
                      <span className={`badge ${f.entry.evidence}`}>{f.entry.evidence}</span>
                    </td>
                    <td className={magClass(f.match?.magnitude ?? 0)}>{f.match?.magnitude ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
