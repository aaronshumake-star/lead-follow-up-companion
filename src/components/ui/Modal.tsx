import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { Button } from './Button.tsx'

/**
 * A modal dialog.
 *
 * Escape closes it, focus moves inside on open and returns to the trigger on
 * close, and Tab cycles within the dialog — this is a keyboard-heavy workflow,
 * so a dialog that traps or loses focus would be worse than no dialog.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    focusablesIn(panel)[0]?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const focusables = focusablesIn(panelRef.current)
      if (focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (first === undefined || last === undefined) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previouslyFocused.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 sm:p-8">
      {/* Click-away closes, but only from the backdrop itself. */}
      <div className="absolute inset-0" aria-hidden onClick={onClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 w-full rounded-xl border border-slate-700 bg-slate-900 shadow-2xl',
          size === 'lg' ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            {description !== undefined && <p className="mt-1 text-sm text-slate-400">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
            ×
          </Button>
        </header>

        <div className="px-5 py-4">{children}</div>

        {footer !== undefined && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-800 px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

function focusablesIn(container: HTMLElement | null): HTMLElement[] {
  if (container === null) return []

  return [
    ...container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ]
}
