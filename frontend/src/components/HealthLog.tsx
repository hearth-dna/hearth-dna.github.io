import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { deleteHealthEntry, listHealthLog } from '../db/repo'
import { facets, type HealthFilter, NO_FILTER } from '../health/log'
import { useT } from '../i18n/context'
import type { HealthEntry, Person } from '../types'
import { HealthEntryForm } from './HealthEntryForm'
import { HealthTable } from './HealthTable'
import { QuickMeasurement } from './QuickMeasurement'

/**
 * A person's health log: symptoms, home measurements, and dated text from lab reports, letters,
 * diagnoses and medication lists, shown as a sortable, filterable table. Entries are added with a
 * type-first form; documents, blood tests and CSV timelines come in through the Import page,
 * which the two shortcuts here open for this person. Stored locally only; the Ask page offers
 * entries for the context pack.
 */
export function HealthLog({ person }: { person: Person }) {
  const { db, go } = useApp()
  const t = useT()
  const [entries, setEntries] = useState<HealthEntry[]>([])
  const [filter, setFilter] = useState<HealthFilter>(NO_FILTER)
  const [adding, setAdding] = useState(false)

  const reload = async () => setEntries(await listHealthLog(db, person.id))
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per db/person
  useEffect(() => {
    reload()
    setAdding(false)
    setFilter(NO_FILTER)
  }, [db, person.id])

  const { tags } = useMemo(() => facets(entries), [entries])

  return (
    <div className="card">
      <div className="row">
        <h2 style={{ marginRight: 'auto' }}>{t('healthLog.title')}</h2>
        <button type="button" className="primary" disabled={adding} onClick={() => setAdding(true)}>
          {t('healthLog.addEntry')}
        </button>
        <button type="button" onClick={() => go({ name: 'import', source: 'document', person: person.id })}>
          {t('healthLog.readDocument')}
        </button>
        <button type="button" onClick={() => go({ name: 'import', source: 'csv', person: person.id })}>
          {t('healthLog.importCsv')}
        </button>
      </div>
      <p className="muted">{t('healthLog.intro')}</p>
      <QuickMeasurement persons={[person]} personId={person.id} entries={entries} onSaved={reload} />
      {adding && (
        <HealthEntryForm
          persons={[person]}
          personId={person.id}
          tagSuggestions={tags}
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
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
        onChange={reload}
        onDelete={async (e) => {
          if (confirm(t('healthLog.confirmDelete', { title: e.title, date: e.date }))) {
            await deleteHealthEntry(db, e.id)
            await reload()
          }
        }}
      />
    </div>
  )
}
