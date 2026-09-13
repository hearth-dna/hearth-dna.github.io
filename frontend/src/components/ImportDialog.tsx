import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { grantConsent, hasConsent } from '../consent/consent'
import { importCalls } from '../db/repo'
import { parseRawText } from '../import/parseFile'
import { detectProvider } from '../import/providers'
import { fileToText, sha256Hex } from '../import/unpack'
import { PROVIDER_LABELS, type Provider } from '../types'
import { ConsentForm } from './ConsentForm'

type Stage =
  | { s: 'consent' }
  | { s: 'pick' }
  | { s: 'working'; msg: string; pct: number }
  | { s: 'done'; msg: string }
  | { s: 'error'; msg: string }

export function ImportDialog({ personId, onClose }: { personId: string; onClose: () => void }) {
  const { db, persons, refresh } = useApp()
  const person = persons.find((p) => p.id === personId)!
  const isMinor = person.birthYear !== null && new Date().getFullYear() - person.birthYear < 18
  const ref = useRef<HTMLDialogElement>(null)
  const [stage, setStage] = useState<Stage>({ s: 'consent' })
  const [minorOk, setMinorOk] = useState(!isMinor)
  const [forced, setForced] = useState<Provider | ''>('')

  useEffect(() => {
    ref.current?.showModal()
    hasConsent(db, 'import_genome', personId).then((ok) => ok && setStage({ s: 'pick' }))
  }, [db, personId])

  const run = async (file: File) => {
    try {
      setStage({ s: 'working', msg: 'Unpacking…', pct: 0 })
      const { text, innerName } = await fileToText(file)
      const sha256 = await sha256Hex(text)
      setStage({
        s: 'working',
        msg: `Parsing ${innerName} (${PROVIDER_LABELS[forced || detectProvider(text)]})…`,
        pct: 0,
      })
      const r = await parseRawText(
        text,
        (d, t) => setStage({ s: 'working', msg: 'Parsing…', pct: (d / t) * 50 }),
        forced || undefined,
      )
      if (r.calls.length === 0) throw new Error('no genotype rows recognised — pick the provider manually')
      setStage({ s: 'working', msg: `Storing ${r.calls.length.toLocaleString()} calls…`, pct: 50 })
      await importCalls(
        db,
        personId,
        { provider: r.provider, build: r.build, sha256, originalName: file.name },
        r.calls,
        (n) =>
          setStage({
            s: 'working',
            msg: `Storing ${n.toLocaleString()} / ${r.calls.length.toLocaleString()}…`,
            pct: 50 + (n / r.calls.length) * 50,
          }),
      )
      await refresh()
      setStage({
        s: 'done',
        msg: `${r.calls.length.toLocaleString()} calls imported from ${PROVIDER_LABELS[r.provider]} (build ${r.build}); ${r.skipped.toLocaleString()} no-calls skipped.`,
      })
    } catch (e) {
      setStage({ s: 'error', msg: String(e) })
    }
  }

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>Import DNA for {person.displayName}</h2>
      {stage.s === 'consent' && (
        <div>
          {isMinor && (
            <div className="notice">
              <strong>This person is under 18.</strong>
              <label className="check">
                <input type="checkbox" checked={minorOk} onChange={(e) => setMinorOk(e.target.checked)} />
                <span>
                  I am this child's parent or legal guardian and will delete this data on their request.
                </span>
              </label>
            </div>
          )}
          <ConsentForm
            kind="import_genome"
            onCancel={() => ref.current?.close()}
            onConfirm={async () => {
              if (!minorOk) return
              await grantConsent(db, 'import_genome', personId)
              if (isMinor) await grantConsent(db, 'import_minor', personId)
              setStage({ s: 'pick' })
            }}
          />
        </div>
      )}
      {stage.s === 'pick' && (
        <div>
          <p className="muted">
            Accepted: raw text/CSV/VCF, or a .zip / .gz containing one. Everything is parsed here in the
            browser.
          </p>
          <label className="field">
            Provider
            <select value={forced} onChange={(e) => setForced(e.target.value as Provider | '')}>
              <option value="">auto-detect</option>
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <p>
            <input
              type="file"
              accept=".txt,.csv,.vcf,.zip,.gz,.tsv"
              onChange={(e) => e.target.files?.[0] && run(e.target.files[0])}
            />
          </p>
          <button type="button" onClick={() => ref.current?.close()}>
            Cancel
          </button>
        </div>
      )}
      {stage.s === 'working' && (
        <div>
          <p>{stage.msg}</p>
          <progress value={stage.pct} max={100} />
        </div>
      )}
      {stage.s === 'done' && (
        <div>
          <p className="ok">{stage.msg}</p>
          <button type="button" className="primary" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
      )}
      {stage.s === 'error' && (
        <div>
          <p className="danger">{stage.msg}</p>
          <button type="button" onClick={() => setStage({ s: 'pick' })}>
            Try again
          </button>
        </div>
      )}
    </dialog>
  )
}
