import { useEffect, useId, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Escape-to-close, role/aria wiring, a focus trap within the dialog, and focus restore
 *  to whatever had focus before the dialog opened. Shared by EventDialog and SettingsDialog
 *  so both modals behave identically rather than shipping two different keyboard contracts. */
export function useDialogA11y(onClose: () => void): {
  ref: React.RefObject<HTMLDivElement>
  dialogProps: { role: 'dialog'; 'aria-modal': true; 'aria-labelledby': string; tabIndex: -1 }
  titleId: string
} {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => {
      previouslyFocused.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled')
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return {
    ref,
    dialogProps: { role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId, tabIndex: -1 },
    titleId
  }
}
