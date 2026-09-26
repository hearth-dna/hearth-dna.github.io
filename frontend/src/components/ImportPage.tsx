import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import type { ImportSource } from '../app/routes'
import { listHealthLog, listSourceFiles } from '../db/repo'
import type { HealthDraft } from '../documents/draft'
import { facets } from '../health/log'
import { useT } from '../i18n/context'
import { importBatches } from '../import/history'
import type { LabReportDraft } from '../labs/types'
import { type HealthEntry, PROVIDER_LABELS, type SourceFile } from '../types'
import { BatchImportDialog } from './BatchImportDialog'
import { HealthEntryForm } from './HealthEntryForm'
import { ImportDialog } from './ImportDialog'
import { LabReviewTable } from './LabReviewTable'
import { ReadDocumentDialog } from './ReadDocumentDialog'
import { TimelineImportDialog } from './TimelineImportDialog'

type Done = { kind: 'dna' | 'health'; n?: number } | null

/**
 * Everything that comes into Hearth from outside, in one place: raw DNA files, documents and
 * blood tests (photos, scans, PDFs, pasted text), and CSV timelines. Pick the person, pick the
 * source; the review steps (lab table, document draft) happen here too, and the history shows
 * what was imported for that person and how. The URL names the source to open straight away,
 * which is how the shortcuts on People and in the health log land here.
 */
export function ImportPage({ source, person: personId }: { source: ImportSource; person: string }) {
  const { db, persons, go } = useApp()
  const t = useT()
  const person = persons.find((p) => p.id === personId) ?? null
  const [entries, setEntries] = useState<HealthEntry[]>([])
  const [files, setFiles] = useState<SourceFile[]>([])
  const [lab, setLab] = useState<{ draft: LabReportDraft; source: string } | null>(null)
  const [doc, setDoc] = useState<{ draft: HealthDraft; source: string } | null>(null)
  const [done, setDone] = useState<Done>(null)

  const reload = async () => {
    if (!personId) return
    setEntries(await listHealthLog(db, personId))
    setFiles((await listSourceFiles(db)).filter((f) => f.personId === personId))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per db/person
  useEffect(() => {
    reload()
    setLab(null)
    setDoc(null)
  }, [db, personId])

  const open = (s: ImportSource) => {
    setDone(null)
    go({ name: 'import', source: s, person: personId })
  }
  /** A dialog closed: back to the page without a source, so Back does not reopen it. */
  const closed = () => go({ name: 'import', source: '', person: personId })
  const finished = async (d: Done) => {
    setDone(d)
    await reload()
  }

  const needsPerson = !person
  const batches = importBatches(entries)
  const card = (s: ImportSource, title: string, what: string, where: string, extra?: React.ReactNode) => (
    <div className="card">
      <h2 className="mt-0">{title}</h2>
      <p className="muted">{what}</p>
      <p className="muted">{where}</p>
      <div className="actions stacked">
        {extra}
        <button type="button" className="primary" disabled={needsPerson} onClick={() => open(s)}>
          {person ? t('importPage.forPerson', { name: person.displayName }) : t('importPage.pickFirst')}
        </button>
      </div>
    </div>
  )

  return (
    <div>
      <h1>{t('importPage.title')}</h1>
      <p className="muted">{t('importPage.intro')}</p>
      <div className="card">
        {persons.length === 0 ? (
          <p className="notice">
            {t('importPage.noPeople')}{' '}
            <button type="button" className="primary" onClick={() => go({ name: 'people' })}>
              {t('app.navPeople')}
            </button>
          </p>
        ) : (
          <label className="field">
            {t('importPage.person')}
            <select
              value={personId}
              onChange={(e) => {
                setDone(null)
                go({ name: 'import', source: '', person: e.target.value })
              }}
            >
              <option value="">{t('healthForm.pickPerson')}</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {done && person && (
          <p className="notice ok">
            {done.kind === 'dna' ? t('importPage.doneDna') : t('importPage.doneHealth', { n: done.n ?? 0 })}{' '}
            {done.kind === 'dna' ? (
              <button type="button" onClick={() => go({ name: 'person', id: person.id })}>
                {t('importPage.openPerson')}
              </button>
            ) : (
              <>
                <button type="button" onClick={() => go({ name: 'health', person: person.id })}>
                  {t('importPage.openLog')}
                </button>{' '}
                <button type="button" onClick={() => go({ name: 'charts' })}>
                  {t('app.navCharts')}
                </button>
              </>
            )}
          </p>
        )}
      </div>

      {lab && person && (
        <LabReviewTable
          key={lab.source}
          person={person}
          draft={lab.draft}
          source={lab.source}
          onCancel={() => setLab(null)}
          onSaved={async (n) => {
            setLab(null)
            await finished({ kind: 'health', n })
          }}
        />
      )}
      {doc && person && (
        <HealthEntryForm
          key={doc.source}
          persons={[person]}
          personId={person.id}
          draft={doc}
          tagSuggestions={facets(entries).tags}
          onCancel={() => setDoc(null)}
          onSaved={async () => {
            setDoc(null)
            await finished({ kind: 'health', n: 1 })
          }}
        />
      )}

      <div className="grid">
        {card(
          'dna',
          t('importPage.dnaTitle'),
          t('importPage.dnaWhat', { providers: Object.values(PROVIDER_LABELS).join(', ') }),
          t('importPage.local'),
          <button type="button" onClick={() => open('dna-batch')}>
            {t('peoplePage.importSeveral')}
          </button>,
        )}
        {card(
          'document',
          t('importPage.documentTitle'),
          t('importPage.documentWhat'),
          t('importPage.documentWhere'),
        )}
        {card('csv', t('importPage.csvTitle'), t('importPage.csvWhat'), t('importPage.local'))}
      </div>

      {person && (files.length > 0 || batches.length > 0) && (
        <div className="card">
          <h2 className="mt-0">{t('importPage.history', { name: person.displayName })}</h2>
          <ul>
            {files.map((f) => (
              <li key={f.id}>
                {t('importPage.historyDna', {
                  provider: PROVIDER_LABELS[f.provider],
                  file: f.originalName,
                  n: f.rowCount.toLocaleString(),
                  date: f.importedAt.slice(0, 10),
                })}
              </li>
            ))}
            {batches.map((b) => (
              <li key={b.source}>
                {t(`importPage.historyVia.${b.via}`, { model: b.model })} ·{' '}
                {t('importPage.historyEntries', {
                  n: b.count,
                  from: b.from,
                  to: b.to,
                  date: b.at.slice(0, 10),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {source === 'dna' && person && (
        <ImportDialog
          personId={person.id}
          onClose={async () => {
            closed()
            const before = files.length
            await reload()
            const after = (await listSourceFiles(db)).filter((f) => f.personId === person.id).length
            if (after > before) setDone({ kind: 'dna' })
          }}
        />
      )}
      {source === 'dna-batch' && <BatchImportDialog onClose={closed} />}
      {source === 'document' && person && (
        <ReadDocumentDialog
          person={person}
          onClose={closed}
          onDraft={(draft, s) => setDoc({ draft, source: s })}
          onLabDraft={(draft, s) => setLab({ draft, source: s })}
        />
      )}
      {source === 'csv' && person && (
        <TimelineImportDialog
          person={person}
          onClose={closed}
          onImported={(n) => finished({ kind: 'health', n })}
        />
      )}
    </div>
  )
}
