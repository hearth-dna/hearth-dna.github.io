import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { deleteHealthEntry, listHealthLog } from '../db/repo'
import type { HealthDraft } from '../documents/draft'
import { facets, type HealthFilter, NO_FILTER } from '../health/log'
import { useT } from '../i18n/context'
import type { HealthEntry, Person } from '../types'
import { HealthEntryForm } from './HealthEntryForm'
import { HealthTable } from './HealthTable'
import { ReadDocumentDialog } from './ReadDocumentDialog'

/**
 * A person's health log: symptoms, home measurements, and dated text from lab reports, letters,
 * diagnoses and medication lists, shown as a sortable, filterable table. Entries are added with a
 * type-first form or transcribed from a document. Stored locally only; the Ask page offers
 * entries for the context pack.
 */
export function HealthLog({ person }: { person: Person }) {
  const { db } = useApp()
  const t = useT()
  const [entries, setEntries] = useState<HealthEntry[]>([])
  const [filter, setFilter] = useState<HealthFilter>(NO_FILTER)
  const [adding, setAdding] = useState<{ draft?: { draft: HealthDraft; source: string } } | null>(null)
  const [reading, setReading] = useState(false)

  const reload = async () => setEntries(await listHealthLog(db, person.id))
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per db/person
  useEffect(() => {
    reload()
    setAdding(null)
    setFilter(NO_FILTER)
  }, [db, person.id])

  const { tags } = useMemo(() => facets(entries), [entries])

  return (
    <div className="card">
      <div className="row">
        <h2 style={{ marginRight: 'auto' }}>{t('healthLog.title')}</h2>
        <button type="button" className="primary" disabled={!!adding} onClick={() => setAdding({})}>
          {t('healthLog.addEntry')}
        </button>
        <button type="button" onClick={() => setReading(true)}>
          {t('healthLog.readDocument')}
        </button>
      </div>
      <p className="muted">{t('healthLog.intro')}</p>
      {adding && (
        <HealthEntryForm
          key={adding.draft?.source ?? 'new'}
          persons={[person]}
          personId={person.id}
          draft={adding.draft}
          tagSuggestions={tags}
          onCancel={() => setAdding(null)}
          onSaved={async () => {
            setAdding(null)
            await reload()
          }}
        />
      )}
      <HealthTable
        entries={entries}
        persons={[person]}
        showPerson={false}
        filter={filter}
        onFilter={setFilter}
        onDelete={async (e) => {
          if (confirm(t('healthLog.confirmDelete', { title: e.title, date: e.date }))) {
            await deleteHealthEntry(db, e.id)
            await reload()
          }
        }}
      />
      {reading && (
        <ReadDocumentDialog
          person={person}
          onClose={() => setReading(false)}
          onDraft={(draft, source) => setAdding({ draft: { draft, source } })}
        />
      )}
    </div>
  )
}
