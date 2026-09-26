import { useEffect, useState } from 'react'
import { APP_VERSION, useApp } from '../app/context'
import { setTheme, THEMES, useTheme } from '../app/theme'
import { listConsents, revokeConsent, revokeDeletesData } from '../consent/consent'
import { CONSENTS } from '../consent/kinds'
import { getMeta, listSharing, META_GEMINI_KEY, META_GEMINI_MODEL, newId, setMeta } from '../db/repo'
import { GEMINI_DEFAULT_MODEL } from '../egress/egress'
import { exportDumpFile } from '../export/exportDump'
import { restoreBytes } from '../export/restore'
import { LANGUAGES, useI18n } from '../i18n/context'
import { isLanguage } from '../i18n/languages'
import { ArchiveCard } from './ArchiveCard'
import { BackupCard } from './BackupCard'
import { EraseDialog } from './EraseDialog'
import { GeminiKeySteps } from './GeminiKeySteps'
import { OpenFormatsCard } from './OpenFormatsCard'

export function SettingsPage() {
  const { db, persons, refresh } = useApp()
  const { t, lang, setLang } = useI18n()
  const theme = useTheme()
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [consents, setConsents] = useState<Awaited<ReturnType<typeof listConsents>>>([])
  const [sharing, setSharing] = useState<Awaited<ReturnType<typeof listSharing>>>([])
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiModel, setGeminiModel] = useState(GEMINI_DEFAULT_MODEL)
  const [keyStored, setKeyStored] = useState(false)
  const [erasing, setErasing] = useState(false)
  const reload = async () => {
    setConsents(await listConsents(db))
    setSharing(await listSharing(db))
    setKeyStored((await getMeta(db, META_GEMINI_KEY)) !== null)
    setGeminiModel((await getMeta(db, META_GEMINI_MODEL)) || GEMINI_DEFAULT_MODEL)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per db
  useEffect(() => {
    reload()
  }, [db])

  const exportDump = async () => {
    setMsg(t('settingsPage.buildingDump'))
    const r = await exportDumpFile(db, APP_VERSION, pass)
    setMsg(t(r.encrypted ? 'exportDump.encrypted' : 'exportDump.plaintext', { name: r.name, mb: r.mb }))
  }

  const importDump = async (file: File) => {
    try {
      setMsg(t('settingsPage.readingDump'))
      const bytes = new Uint8Array(await file.arrayBuffer())
      const r = await restoreBytes(db, bytes, pass || undefined, (key, params) => setMsg(t(key, params)))
      await refresh()
      await reload()
      const { people, genomes, version, exportedAt, missing } = r
      const imported = t('settingsPage.imported', { people, genomes, version, exportedAt })
      setMsg(
        missing.length
          ? `${imported} ${t('restore.missingGenomes', { names: missing.map((m) => m.name).join(', ') })}`
          : imported,
      )
    } catch (e) {
      setMsg(t('settingsPage.importFailed', { error: String(e) }))
    }
  }

  return (
    <div>
      <h1>{t('settingsPage.title')}</h1>
      <div className="card">
        <h2>{t('common.language')}</h2>
        <select value={lang} onChange={(e) => isLanguage(e.target.value) && setLang(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <p className="muted">{t('settingsPage.languageNote')}</p>
      </div>

      <div className="card">
        <h2>{t('settingsPage.appearance')}</h2>
        <div className="segmented">
          {THEMES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={theme === m}
              className={theme === m ? 'active' : ''}
              onClick={() => setTheme(m)}
            >
              {t(`theme.${m}`)}
            </button>
          ))}
        </div>
        <p className="muted">{t('settingsPage.appearanceNote')}</p>
      </div>

      <div className="card">
        <h2>{t('settingsPage.fullDump')}</h2>
        <p className="muted">{t('settingsPage.fullDumpIntro')}</p>
        <div className="row">
          <label className="field">
            {t('settingsPage.passphrase')}
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
          <button type="button" className="primary" onClick={exportDump} disabled={persons.length === 0}>
            {t('settingsPage.exportDump')}
          </button>
          <label className="btn">
            {t('settingsPage.importDump')}{' '}
            <input
              type="file"
              hidden
              accept=".hearth,.enc,.gz,.json,.html"
              onChange={(e) => e.target.files?.[0] && importDump(e.target.files[0])}
            />
          </label>
        </div>
        {msg && <p>{msg}</p>}
      </div>

      <BackupCard />
      <ArchiveCard />
      <OpenFormatsCard />

      <div className="card">
        <h2>{t('settingsPage.documentReading')}</h2>
        <p className="muted">{t('settingsPage.documentReadingIntro')}</p>
        <p className="notice">{t('settingsPage.freeTierNotice')}</p>
        <GeminiKeySteps open={!keyStored} />
        <div className="row">
          <label className="field">
            {t('settingsPage.apiKey')} {keyStored && <span className="ok">{t('settingsPage.stored')}</span>}
            <input
              type="password"
              autoComplete="off"
              value={geminiKey}
              placeholder={keyStored ? t('settingsPage.replaceKeyPlaceholder') : 'AIza…'}
              onChange={(e) => setGeminiKey(e.target.value)}
            />
          </label>
          <label className="field">
            {t('settingsPage.model')}
            <input value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!geminiKey.trim() && !keyStored}
            onClick={async () => {
              if (geminiKey.trim()) await setMeta(db, META_GEMINI_KEY, geminiKey.trim())
              await setMeta(
                db,
                META_GEMINI_MODEL,
                geminiModel.trim() === GEMINI_DEFAULT_MODEL ? null : geminiModel.trim(),
              )
              setGeminiKey('')
              await reload()
              setMsg(t('settingsPage.geminiSaved'))
            }}
          >
            {t('common.save')}
          </button>
          {keyStored && (
            <button
              type="button"
              className="danger"
              onClick={async () => {
                await setMeta(db, META_GEMINI_KEY, null)
                await reload()
                setMsg(t('settingsPage.geminiRemoved'))
              }}
            >
              {t('settingsPage.removeKey')}
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h2>{t('settingsPage.consents')}</h2>
        {consents.length === 0 ? (
          <p className="muted">{t('settingsPage.noneRecorded')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('settingsPage.consent')}</th>
                <th>{t('settingsPage.subject')}</th>
                <th>{t('settingsPage.granted')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {consents.map((c) => (
                <tr key={`${c.kind}-${c.subject}-${c.grantedAt}`}>
                  <td>
                    {CONSENTS[c.kind] ? t(CONSENTS[c.kind].title) : c.kind}{' '}
                    <span className="muted">v{c.version}</span>
                  </td>
                  <td>{persons.find((p) => p.id === c.subject)?.displayName ?? (c.subject || '—')}</td>
                  <td>{c.grantedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <button
                      type="button"
                      className="danger"
                      onClick={async () => {
                        const who = persons.find((p) => p.id === c.subject)?.displayName ?? c.subject
                        const what = t(
                          c.kind === 'import_document' ? 'settingsPage.healthLog' : 'settingsPage.genome',
                        )
                        if (
                          revokeDeletesData(c.kind) &&
                          !confirm(t('settingsPage.revokeConfirm', { who, what }))
                        )
                          return
                        await revokeConsent(db, c.kind, c.subject)
                        // Withdrawing the first-launch consent puts the app back behind the gate.
                        if (c.kind === 'first_launch') return location.reload()
                        await refresh()
                        await reload()
                      }}
                    >
                      {t('settingsPage.revoke')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>{t('settingsPage.sharingLog')}</h2>
        <p className="muted">{t('settingsPage.sharingLogIntro')}</p>
        {sharing.length === 0 ? (
          <p className="muted">{t('common.empty')}</p>
        ) : (
          <ul>
            {sharing.map((s) => (
              <li key={s.id}>
                <details>
                  <summary>
                    {t('settingsPage.sharingSummary', {
                      date: s.createdAt.slice(0, 16).replace('T', ' '),
                      kind: s.kind,
                      destination: s.destination,
                      chars: s.payload.length,
                    })}
                  </summary>
                  <pre className="pack">{s.payload}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>{t('settingsPage.eraseEverything')}</h2>
        <p className="muted">{t('settingsPage.eraseIntro')}</p>
        <button type="button" className="danger" onClick={() => setErasing(true)}>
          {t('settingsPage.eraseAllData')}
        </button>
        {erasing && <EraseDialog onClose={() => setErasing(false)} />}
      </div>
      <p className="muted">
        {t('settingsPage.footer', {
          version: APP_VERSION,
          storage: t(db.persistent ? 'settingsPage.storageOpfs' : 'settingsPage.storageMemory'),
          id: newId().slice(0, 8),
        })}
      </p>
    </div>
  )
}
