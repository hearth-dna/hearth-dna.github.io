import { useState } from 'react'
import { useApp } from '../app/context'
import { addPerson, deletePerson, setParent, unsetParent } from '../db/repo'
import { PROVIDER_LABELS, type Sex } from '../types'
import { ImportDialog } from './ImportDialog'

export function PeoplePage({ onOpen }: { onOpen: (id: string) => void }) {
  const { db, persons, counts, relationships, refresh } = useApp()
  const [form, setForm] = useState({ label: '', displayName: '', sex: 'unknown' as Sex, birthYear: '' })
  const [importFor, setImportFor] = useState<string | null>(null)

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

  return (
    <div>
      <h1>People</h1>
      <div className="card">
        <h2>Add a person</h2>
        <div className="row">
          <label className="field">
            Short label
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="vova"
            />
          </label>
          <label className="field">
            Display name
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="Vova"
            />
          </label>
          <label className="field">
            Sex
            <select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value as Sex })}>
              <option value="unknown">unknown</option>
              <option value="male">male</option>
              <option value="female">female</option>
            </select>
          </label>
          <label className="field">
            Birth year
            <input
              value={form.birthYear}
              onChange={(e) => setForm({ ...form, birthYear: e.target.value })}
              placeholder="1984"
              style={{ width: '6rem' }}
            />
          </label>
          <button type="button" className="primary" onClick={submit}>
            Add
          </button>
        </div>
      </div>

      {persons.length === 0 && (
        <p className="muted">
          No one yet. Add a person, then import their raw DNA file (
          {Object.values(PROVIDER_LABELS).join(', ')}).
        </p>
      )}

      <div className="grid">
        {persons.map((p) => (
          <div className="card" key={p.id}>
            <h3>
              {p.displayName} <span className="muted">({p.label})</span>
            </h3>
            <p className="muted">
              {p.sex}
              {p.birthYear ? ` · born ${p.birthYear}` : ''} ·{' '}
              {counts[p.id] ? `${counts[p.id].toLocaleString()} SNPs` : 'no genotypes yet'}
            </p>
            <p className="muted">
              Parents:{' '}
              {parentsOf(p.id).length === 0
                ? 'none set'
                : parentsOf(p.id)
                    .map((pid) => persons.find((x) => x.id === pid)?.displayName ?? '?')
                    .join(', ')}
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
                <option value="">+ parent…</option>
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
                  − {persons.find((x) => x.id === pid)?.displayName}
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <button type="button" className="primary" onClick={() => setImportFor(p.id)}>
                Import DNA file
              </button>
              <button type="button" onClick={() => onOpen(p.id)} disabled={!counts[p.id]}>
                Report
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  if (confirm(`Delete ${p.displayName} and all their data?`)) {
                    await deletePerson(db, p.id)
                    await refresh()
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {importFor && <ImportDialog personId={importFor} onClose={() => setImportFor(null)} />}
    </div>
  )
}
