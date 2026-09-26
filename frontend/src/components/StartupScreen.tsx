import { useEffect, useState } from 'react'
import { formatDuration, type StepState } from '../app/startup'
import { useT } from '../i18n/context'

/**
 * The first screen: every start-up step with a spinner while it runs and its time when done, and
 * the total so far. A slow step (waiting for another tab, a large genome count) is visible by
 * name. On failure the steps stay on screen above the error so it is clear where it stopped.
 */
export function StartupScreen({
  steps,
  startedAt,
  error,
}: {
  steps: StepState[]
  startedAt: number
  error?: string | null
}) {
  const t = useT()
  // Re-render on a timer for the running clocks; read the clock at render so a step change in a
  // background tab (where timers are throttled) still shows the right time.
  const [, tick] = useState(0)
  const now = performance.now()
  const running = !error && steps.some((s) => s.endedAt === null)
  useEffect(() => {
    if (error) return
    const timer = setInterval(() => tick((n) => n + 1), 100)
    return () => clearInterval(timer)
  }, [error])

  return (
    <main>
      <div className="card startup">
        <h2 className="mt-0">{t('startup.title')}</h2>
        <ul className="steps">
          {steps.map((s) => {
            const done = s.endedAt !== null
            const failed = !done && !!error
            return (
              <li key={s.id} className={done ? 'done' : failed ? 'failed' : 'running'}>
                <span className="mark" aria-hidden="true">
                  {done ? '✓' : failed ? '✕' : <span className="spinner" />}
                </span>
                <span>{t(`startup.step.${s.id}`, s.detail)}</span>
                <span className="muted time">
                  {formatDuration((s.endedAt ?? (error ? s.startedAt : now)) - s.startedAt)}
                </span>
              </li>
            )
          })}
        </ul>
        {!error && (
          <p className="muted">
            {t(running ? 'startup.elapsed' : 'startup.almost', {
              time: formatDuration(now - startedAt),
            })}
          </p>
        )}
        {error && <div className="card danger">{t('app.startFailed', { error })}</div>}
      </div>
    </main>
  )
}
