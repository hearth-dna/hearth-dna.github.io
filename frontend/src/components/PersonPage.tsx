import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { listSourceFiles, mendelianSql, personCallsFor } from '../db/repo'
import { useT } from '../i18n/context'
import { computeFindings, type Finding } from '../kb/kb'
import { DEFAULT_DIR, type FindingSortKey, type SortDir, sortFindings } from '../kb/sortFindings'
import { PROVIDER_LABELS, type SourceFile } from '../types'
import { HealthLog } from './HealthLog'

export function PersonPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { db, kb, persons, relationships } = useApp()
  const t = useT()
  const person = persons.find((p) => p.id === id)!
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [files, setFiles] = useState<SourceFile[]>([])
  const [sort, setSort] = useState<{ key: FindingSortKey; dir: SortDir }>({ key: 'magnitude', dir: 'desc' })
  /** `label` is null for the trio row (both parents), named at render time. */
  const [mendel, setMendel] = useState<
    { label: string | null; compared: number; violations: number; rate: number }[]
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
      const out: { label: string | null; compared: number; violations: number; rate: number }[] = []
      for (const pid of parentIds) {
        const label = persons.find((p) => p.id === pid)?.displayName ?? pid
        out.push({ label, ...(await mendelianSql(db, id, pid)) })
      }
      if (parentIds.length === 2) {
        out.push({
          label: null,
          ...(await mendelianSql(db, id, parentIds[0], parentIds[1])),
        })
      }
      setMendel(out)
    })()
  }, [db, kb, id, persons, relationships])

  const magClass = (m: number) => (m >= 3 ? 'mag hi' : m >= 2 ? 'mag mid' : 'mag')
  const sorted = findings && sortFindings(findings, sort.key, sort.dir)
  const toggleSort = (key: FindingSortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR[key] },
    )
  const SortTh = ({ k, children }: { k: FindingSortKey; children: string }) => (
    <th aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="sort" onClick={() => toggleSort(k)}>
        {children}
        <span className="muted"> {sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </button>
    </th>
  )

  return (
    <div>
      <button type="button" onClick={onBack}>
        {t('personPage.back')}
      </button>
      <h1>{person.displayName}</h1>
      <div className="card">
        <h2>{t('personPage.sources')}</h2>
        {files.length === 0 ? (
          <p className="muted">{t('personPage.none')}</p>
        ) : (
          <ul>
            {files.map((f) => (
              <li key={f.id}>
                {t('personPage.sourceLine', {
                  provider: PROVIDER_LABELS[f.provider],
                  build: f.build,
                  calls: f.rowCount.toLocaleString(),
                  name: f.originalName,
                  sha: f.sha256.slice(0, 12),
                })}
              </li>
            ))}
          </ul>
        )}
        {mendel.length > 0 && (
          <>
            <h3>{t('personPage.mendelTitle')}</h3>
            <ul>
              {mendel.map((m) => (
                <li key={m.label ?? 'trio'}>
                  {t('personPage.mendelLine', {
                    label: m.label ?? t('personPage.bothParents'),
                    violations: m.violations.toLocaleString(),
                    compared: m.compared.toLocaleString(),
                    rate: (m.rate * 100).toFixed(2),
                  })}{' '}
                  <span className={m.rate < 0.01 ? 'ok' : 'danger'}>
                    {m.rate < 0.01
                      ? t('personPage.consistent')
                      : m.rate < 0.03
                        ? t('personPage.borderline')
                        : t('personPage.inconsistent')}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <HealthLog person={person} />
      <div className="card">
        <h2>{t('personPage.findingsTitle')}</h2>
        <p className="muted">{t('personPage.findingsIntro')}</p>
        {findings === null ? (
          <p className="muted">{t('personPage.computing')}</p>
        ) : findings.length === 0 ? (
          <p className="muted">{t('personPage.noMarkers')}</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <SortTh k="gene">{t('personPage.colGene')}</SortTh>
                  <SortTh k="riskCopies">{t('personPage.colGenotype')}</SortTh>
                  <SortTh k="topic">{t('personPage.colMeaning')}</SortTh>
                  <SortTh k="evidence">{t('personPage.colEvidence')}</SortTh>
                  <SortTh k="magnitude">{t('personPage.colImpact')}</SortTh>
                </tr>
              </thead>
              <tbody>
                {sorted?.map((f) => (
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
                      <span className="muted">{t('personPage.riskCopies', { n: f.riskCopies })}</span>
                    </td>
                    <td>
                      {f.match?.label ?? (
                        <span className="muted">{t('personPage.genotypeNotDescribed')}</span>
                      )}
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
