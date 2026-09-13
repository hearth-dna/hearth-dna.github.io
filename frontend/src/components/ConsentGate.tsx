import { useApp } from '../app/context'
import { grantConsent } from '../consent/consent'
import { ConsentForm } from './ConsentForm'

export function ConsentGate({ onDone }: { onDone: () => void }) {
  const { db } = useApp()
  return (
    <main>
      <h1>Hearth — a local-first family genome browser</h1>
      <div className="card">
        <p>
          Your DNA files, family tree and notes are stored <strong>only in this browser</strong>. There is no
          account and no server-side copy. To move data between devices, export a dump from Settings.
        </p>
        <ConsentForm
          kind="first_launch"
          confirmLabel="Start"
          onConfirm={async () => {
            try {
              await grantConsent(db, 'first_launch')
              onDone()
            } catch (e) {
              console.error('[hearth] consent write failed', e)
              alert(`Could not record consent: ${e}`)
            }
          }}
        />
      </div>
    </main>
  )
}
