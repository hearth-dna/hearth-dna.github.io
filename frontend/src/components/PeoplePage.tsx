import { useState } from 'react'
import { useApp } from '../app/context'
import { addPerson, deletePerson, setParent, unsetParent, updatePerson } from '../db/repo'
import { useT } from '../i18n/context'
import { type Person, PROVIDER_LABELS, type Sex } from '../types'
import { BatchImportDialog } from './BatchImportDialog'
import { FamilyTree } from './FamilyTree'
import { ImportDialog } from './ImportDialog'

type View = 'cards' | 'table' | 'tree'
const VIEWS: View[] = ['cards', 'table', 'tree']
const VIEW_KEY = 'hearth.peopleView'

const loadView = (): View => {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return VIEWS.includes(v as View) ? (v as View) : 'cards'
  } catch {
    return 'cards'
  }
}

export function PeoplePage({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT()
  const { db, persons, counts, relationships, refresh } = useApp()
  const [form, setForm] = useState({ label: '', displayName: '', sex: 'unknown' as Sex, birthYear: '' })
  const [importFor, setImportFor] = useState<string | null>(null)
  const [batch, setBatch] = useState(false)
  const [view, setView] = useState<View>(loadView)
  const pickView = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // private mode or blocked storage: the choice just does not survive a reload
    }
  }

  const submit = async () => {
    if (!form.label.trim()) return
    await addPerson(db, {
      label: form.label.trim().toLowerCase(),
      displayName: form.displayName.trim() || form.label.trim(),
      sex: form.sex,
      birthYear: form.birthYear ? Number(form.birthYear) : null,
    })
    setForm({ label: '', displayName: '', sex: 'unknown', birthYear: '' })
    await refresh()
  }
  const sexLabel: Record<Sex, string> = {
    unknown: t('peoplePage.sexUnknown'),
    male: t('peoplePage.sexMale'),
    female: t('peoplePage.sexFemale'),
  }
  const sexOptions = (Object.keys(sexLabel) as Sex[]).map((s) => (
    <option key={s} value={s}>
      {sexLabel[s]}
    </option>
  ))
  const parentsOf = (id: string) => relationships.filter((r) => r.childId === id).map((r) => r.parentId)
  const nameOf = (id: string) => persons.find((x) => x.id === id)?.displayName ?? '?'
  const remove = async (p: Person) => {
    if (confirm(t('peoplePage.confirmDelete', { name: p.displayName }))) {
      await deletePerson(db, p.id)
      await refresh()
    }
  }
  const viewLabel: Record<View, string> = {
    cards: t('peoplePage.viewCards'),
    table: t('peoplePage.viewTable'),
    tree: t('peoplePage.viewTree'),
  }

  return (
    <div>
      <h1>{t('peoplePage.title')}</h1>
      <div className="card">
        <h2>{t('peoplePage.addPerson')}</h2>
        <div className="row">
          <label className="field">
            {t('peoplePage.shortLabel')}
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder={t('peoplePage.shortLabelPlaceholder')}
            />
          </label>
          <label className="field">
            {t('peoplePage.displayName')}
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder={t('peoplePage.displayNamePlaceholder')}
            />
          </label>
          <label className="field">
            {t('peoplePage.sex')}
            <select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value as Sex })}>
              {sexOptions}
            </select>
          </label>
          <label className="field">
            {t('peoplePage.birthYear')}
            <input
              value={form.birthYear}
              onChange={(e) => setForm({ ...form, birthYear: e.target.value })}
              placeholder={t('peoplePage.birthYearPlaceholder')}
              style={{ width: '6rem' }}
            />
          </label>
          <button type="button" className="primary" onClick={submit}>
            {t('peoplePage.add')}
          </button>
          <button type="button" onClick={() => setBatch(true)}>
            {t('peoplePage.importSeveral')}
          </button>
        </div>
      </div>

      {persons.length === 0 ? (
        <p className="muted">
          {t('peoplePage.noOneYet', { providers: Object.values(PROVIDER_LABELS).join(', ') })}
        </p>
      ) : (
        <div className="row filters">
          <span className="muted">{t('peoplePage.view')}</span>
          <div className="segmented">
            {VIEWS.map((v) => (
              <button
                type="button"
                key={v}
                className={view === v ? 'active' : ''}
                aria-pressed={view === v}
                onClick={() => pickView(v)}
              >
                {viewLabel[v]}
              </button>
            ))}
          </div>
        </div>
      )}

      {persons.length > 0 && view === 'cards' && (
        <div className="grid">
          {persons.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              parents={parentsOf(p.id)}
              sexLabel={sexLabel}
              sexOptions={sexOptions}
              onOpen={onOpen}
              onImport={() => setImportFor(p.id)}
              onDelete={() => remove(p)}
            />
          ))}
        </div>
      )}
      {persons.length > 0 && view === 'table' && (
        <div className="card tablewrap">
          <table>
            <thead>
              <tr>
                <th>{t('peoplePage.name')}</th>
                <th>{t('peoplePage.sex')}</th>
                <th>{t('peoplePage.birthYear')}</th>
                <th>{t('peoplePage.parentsHeader')}</th>
                <th>{t('peoplePage.snpsHeader')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {persons.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.displayName} <span className="muted">({p.label})</span>
                  </td>
                  <td>{sexLabel[p.sex]}</td>
                  <td>{p.birthYear ?? '–'}</td>
                  <td>{parentsOf(p.id).length ? parentsOf(p.id).map(nameOf).join(', ') : '–'}</td>
                  <td>{counts[p.id] ? counts[p.id].toLocaleString() : '–'}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <button type="button" className="small" onClick={() => setImportFor(p.id)}>
                        {t('peoplePage.importDna')}
                      </button>
                      <button
                        type="button"
                        className="small primary"
                        onClick={() => onOpen(p.id)}
                        disabled={!counts[p.id]}
                      >
                        {t('peoplePage.report')}
                      </button>
                      <button type="button" className="small danger" onClick={() => remove(p)}>
                        {t('peoplePage.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {persons.length > 0 && view === 'tree' && (
        <div className="card">
          <FamilyTree onOpen={onOpen} />
        </div>
      )}
      {importFor && <ImportDialog personId={importFor} onClose={() => setImportFor(null)} />}
      {batch && <BatchImportDialog onClose={() => setBatch(false)} />}
    </div>
  )
}

/** One person with inline editing, parent links and the import / report / delete actions. */
function PersonCard({
  person: p,
  parents,
  sexLabel,
  sexOptions,
  onOpen,
  onImport,
  onDelete,
}: {
  person: Person
  parents: string[]
  sexLabel: Record<Sex, string>
  sexOptions: React.ReactNode
  onOpen: (id: string) => void
  onImport: () => void
  onDelete: () => void
}) {
  const t = useT()
  const { db, persons, counts, refresh } = useApp()
  const [edit, setEdit] = useState<{ displayName: string; sex: Sex; birthYear: string } | null>(null)
  const saveEdit = async () => {
    if (!edit?.displayName.trim()) return
    await updatePerson(db, p.id, {
      displayName: edit.displayName.trim(),
      sex: edit.sex,
      birthYear: edit.birthYear ? Number(edit.birthYear) : null,
    })
    setEdit(null)
    await refresh()
  }
  const nameOf = (id: string) => persons.find((x) => x.id === id)?.displayName ?? '?'

  return (
    <div className="card">
      <h3>
        {p.displayName} <span className="muted">({p.label})</span>
      </h3>
      {edit ? (
        <div className="row">
          <label className="field">
            {t('peoplePage.displayName')}
            <input
              value={edit.displayName}
              onChange={(e) => setEdit({ ...edit, displayName: e.target.value })}
            />
          </label>
          <label className="field">
            {t('peoplePage.sex')}
            <select value={edit.sex} onChange={(e) => setEdit({ ...edit, sex: e.target.value as Sex })}>
              {sexOptions}
            </select>
          </label>
          <label className="field">
            {t('peoplePage.birthYear')}
            <input value={edit.birthYear} onChange={(e) => setEdit({ ...edit, birthYear: e.target.value })} />
          </label>
          <button type="button" className="primary" onClick={saveEdit}>
            {t('common.save')}
          </button>
          <button type="button" onClick={() => setEdit(null)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <p className="muted">
          {sexLabel[p.sex]}
          {p.birthYear ? ` · ${t('peoplePage.born', { year: p.birthYear })}` : ''} ·{' '}
          {counts[p.id]
            ? t('peoplePage.snps', { n: counts[p.id].toLocaleString() })
            : t('peoplePage.noGenotypes')}{' '}
          <button
            type="button"
            className="small"
            onClick={() =>
              setEdit({
                displayName: p.displayName,
                sex: p.sex,
                birthYear: p.birthYear ? String(p.birthYear) : '',
              })
            }
          >
            {t('peoplePage.edit')}
          </button>
        </p>
      )}
      <p className="muted">
        {t('peoplePage.parents', {
          parents: parents.length === 0 ? t('peoplePage.noneSet') : parents.map(nameOf).join(', '),
        })}
      </p>
      <div className="row">
        <select
          value=""
          onChange={async (e) => {
            if (!e.target.value) return
            await setParent(db, e.target.value, p.id)
            await refresh()
          }}
        >
          <option value="">{t('peoplePage.addParent')}</option>
          {persons
            .filter((x) => x.id !== p.id && !parents.includes(x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.displayName}
              </option>
            ))}
        </select>
        {parents.map((pid) => (
          <button
            type="button"
            key={pid}
            onClick={async () => {
              await unsetParent(db, pid, p.id)
              await refresh()
            }}
          >
            {t('peoplePage.removeParent', { name: nameOf(pid) })}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: '0.6rem' }}>
        <button type="button" className="primary" onClick={onImport}>
          {t('peoplePage.importDna')}
        </button>
        <button type="button" onClick={() => onOpen(p.id)} disabled={!counts[p.id]}>
          {t('peoplePage.report')}
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          {t('peoplePage.delete')}
        </button>
      </div>
    </div>
  )
}
