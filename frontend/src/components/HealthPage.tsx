import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { removeAttachment } from '../attachments/store'
import { deleteHealthEntry, listAttachments, listFamilyHealthLog } from '../db/repo'
import { facets, type HealthFilter, NO_FILTER } from '../health/log'
import { useT } from '../i18n/context'
import type { Attachment, HealthEntry } from '../types'
import { HealthEntryForm } from './HealthEntryForm'
import { HealthLog } from './HealthLog'
import { HealthTable } from './HealthTable'
import { QuickMeasurement } from './QuickMeasurement'

/**
 * The Health section (`/health-log`): one sortable, filterable table of the whole family's
 * entries, with an add form that asks whose entry it is. Measurements are found in the same
 * table (the Measurement tab, sort by value). Picking a person (`/health-log/<id>`) opens their
 * log with the document reader, the same component the person page embeds.
 */
export function HealthPage({ person: who, onPerson }: { person: string; onPerson: (id: string) => void }) {
  const { db, persons } = useApp()
  const t = useT()
  const [entries, setEntries] = useState<HealthEntry[]>([])
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({})
  const [filter, setFilter] = useState<HealthFilter>(NO_FILTER)
  const [adding, setAdding] = useState(false)

  const reload = async () => {
    const rows = await listFamilyHealthLog(db)
    setEntries(rows)
    setAttachments(
      await listAttachments(
        db,
        rows.map((e) => e.id),
      ),
    )
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per db; `who` re-reads after edits in a person's log
  useEffect(() => {
    reload()
  }, [db, who])

  const { tags } = useMemo(() => facets(entries), [entries])
  const person = persons.find((p) => p.id === who)

  return (
    <div>
      <h1>{t('healthPage.title')}</h1>
      <p className="muted">{t('healthPage.intro')}</p>
      {persons.length === 0 ? (
        <p className="muted">{t('healthPage.noPeople')}</p>
      ) : (
        <div className="row tabs" style={{ marginBottom: '1rem' }}>
          <button type="button" className={!person ? 'active' : ''} onClick={() => onPerson('')}>
            {t('healthPage.everyone')}
          </button>
          {persons.map((p) => (
            <button
              key={p.id}
              type="button"
              className={who === p.id ? 'active' : ''}
              onClick={() => onPerson(p.id)}
            >
              {p.displayName}
            </button>
          ))}
        </div>
      )}
      {person ? (
        <HealthLog person={person} />
      ) : persons.length > 0 ? (
        <div className="card">
          <div className="row">
            <h2 style={{ marginRight: 'auto' }}>{t('healthPage.timeline')}</h2>
            <button type="button" className="primary" disabled={adding} onClick={() => setAdding(true)}>
              {t('healthLog.addEntry')}
            </button>
          </div>
          <QuickMeasurement
            persons={persons}
            personId={filter.person || (persons.length === 1 ? persons[0].id : '')}
            entries={entries}
            onSaved={reload}
          />
          {adding && (
            <HealthEntryForm
              persons={persons}
              personId={filter.person || (persons.length === 1 ? persons[0].id : '')}
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
            persons={persons}
            attachments={attachments}
            showPerson
            filter={filter}
            onFilter={setFilter}
            onDelete={async (e) => {
              if (confirm(t('healthLog.confirmDelete', { title: e.title, date: e.date }))) {
                await deleteHealthEntry(db, e.id)
                await reload()
              }
            }}
            onDeleteAttachment={async (a) => {
              if (confirm(t('attachments.confirmDelete', { name: a.name }))) {
                await removeAttachment(db, a.id)
                await reload()
              }
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
