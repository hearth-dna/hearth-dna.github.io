import { type ReactNode, useEffect, useRef } from 'react'

/**
 * The phone tab bar's "More": a bottom sheet with the pages that have no tab, the status line and
 * Erase data. Closes on Escape, on a tap outside it, and whenever one of its buttons navigates.
 */
export function MoreSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog natively
    <dialog
      ref={ref}
      className="sheet"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="menu">{children}</div>
    </dialog>
  )
}
