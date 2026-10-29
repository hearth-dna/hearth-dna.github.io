import type { ReactNode } from 'react'

/**
 * A quick bar folded to its one-line label until opened, so the log stays in view. The same
 * element whatever it holds (the bar, or the consent form a first save asks for), so it stays
 * open while the person goes through it.
 */
export function QuickBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="quickbar">
      <summary>{label}</summary>
      {children}
    </details>
  )
}
