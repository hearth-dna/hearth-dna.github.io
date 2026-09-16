import { useApp } from '../app/context'
import { grantConsent } from '../consent/consent'
import { rich, useT } from '../i18n/context'
import { ConsentForm } from './ConsentForm'

export function ConsentGate({ onDone }: { onDone: () => void }) {
  const { db } = useApp()
  const t = useT()
  return (
    <main>
      <h1>{t('consentGate.title')}</h1>
      <div className="card">
        <p>{rich(t('consentGate.intro'))}</p>
        <ConsentForm
          kind="first_launch"
          confirmLabel={t('consentGate.start')}
          onConfirm={async () => {
            try {
              await grantConsent(db, 'first_launch')
              onDone()
            } catch (e) {
              console.error('[hearth] consent write failed', e)
              alert(t('consentGate.recordFailed', { error: String(e) }))
            }
          }}
        />
      </div>
    </main>
  )
}
