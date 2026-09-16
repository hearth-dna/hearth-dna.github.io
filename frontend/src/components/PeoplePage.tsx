import { useState } from 'react'
import { useApp } from '../app/context'
import { addPerson, deletePerson, setParent, unsetParent, updatePerson } from '../db/repo'
import { useT } from '../i18n/context'
import { PROVIDER_LABELS, type Sex } from '../types'
import { BatchImportDialog } from './BatchImportDialog'
import { ImportDialog } from './ImportDialog'

export function PeoplePage({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT()
  const { db, persons, counts, relationships, refresh } = useApp()
  const [form, setForm] = useState({ label: '', displayName: '', sex: 'unknown' as Sex, birthYear: '' })
  const [importFor, setImportFor] = useState<string | null>(null)
  const [batch, setBatch] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState({ displayName: '', sex: 'unknown' as Sex, birthYear: '' })
  const startEdit = (id: string) => {
    const p = persons.find((x) => x.id === id)!
    setEdit({ displayName: p.displayName, sex: p.sex, birthYear: p.birthYear ? String(p.birthYear) : '' })
    setEditing(id)
  }
  const saveEdit = async () => {
    if (!editing || !edit.displayName.trim()) return
    await updatePerson(db, editing, {
      displayName: edit.displayName.trim(),
      sex: edit.sex,
      birthYear: edit.birthYear ? Number(edit.birthYear) : null,
    })
    setEditing(null)
    await refresh()
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
  const parentsOf = (id: string) => relationships.filter((r) => r.childId === id).map((r) => r.parentId)
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

      {persons.length === 0 && (
        <p className="muted">
          {t('peoplePage.noOneYet', { providers: Object.values(PROVIDER_LABELS).join(', ') })}
        </p>
      )}

      <div className="grid">
        {persons.map((p) => (
          <div className="card" key={p.id}>
            <h3>
              {p.displayName} <span className="muted">({p.label})</span>
            </h3>
            {editing === p.id ? (
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
                  <input
                    value={edit.birthYear}
                    onChange={(e) => setEdit({ ...edit, birthYear: e.target.value })}
                  />
                </label>
                <button type="button" className="primary" onClick={saveEdit}>
                  {t('common.save')}
                </button>
                <button type="button" onClick={() => setEditing(null)}>
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
                <button type="button" className="small" onClick={() => startEdit(p.id)}>
                  {t('peoplePage.edit')}
                </button>
              </p>
            )}
            <p className="muted">
              {t('peoplePage.parents', {
                parents:
                  parentsOf(p.id).length === 0
                    ? t('peoplePage.noneSet')
                    : parentsOf(p.id)
                        .map((pid) => persons.find((x) => x.id === pid)?.displayName ?? '?')
                        .join(', '),
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
                  .filter((x) => x.id !== p.id && !parentsOf(p.id).includes(x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.displayName}
                    </option>
                  ))}
              </select>
              {parentsOf(p.id).map((pid) => (
                <button
                  type="button"
                  key={pid}
                  onClick={async () => {
                    await unsetParent(db, pid, p.id)
                    await refresh()
                  }}
                >
                  {t('peoplePage.removeParent', {
                    name: persons.find((x) => x.id === pid)?.displayName ?? '',
                  })}
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <button type="button" className="primary" onClick={() => setImportFor(p.id)}>
                {t('peoplePage.importDna')}
              </button>
              <button type="button" onClick={() => onOpen(p.id)} disabled={!counts[p.id]}>
                {t('peoplePage.report')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  if (confirm(t('peoplePage.confirmDelete', { name: p.displayName }))) {
                    await deletePerson(db, p.id)
                    await refresh()
                  }
                }}
              >
                {t('peoplePage.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
      {importFor && <ImportDialog personId={importFor} onClose={() => setImportFor(null)} />}
      {batch && <BatchImportDialog onClose={() => setBatch(false)} />}
    </div>
  )
}
