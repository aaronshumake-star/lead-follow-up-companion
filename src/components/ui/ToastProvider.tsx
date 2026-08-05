import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { ToastContext, type Toast, type ToastContextValue, type ToastTone } from './toast-context.ts'

const AUTO_DISMISS_MS: Record<ToastTone, number> = {
  success: 4000,
  info: 5000,
  // Errors stay until dismissed: a failure that vanishes is a failure missed.
  error: 12_000,
}

/**
 * Toasts for routine confirmations.
 *
 * Logging a call or scheduling a follow-up happens dozens of times a day, so
 * those confirm here rather than in a dialog. Destructive actions use
 * ConfirmDialog instead.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const notify = useCallback<ToastContextValue['notify']>(
    (tone, message, action) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setToasts((current) => [...current.slice(-3), { id, tone, message, action }])

      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS[tone]),
      )
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(() => ({ toasts, notify, dismiss }), [toasts, notify, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      // Assertive so an error is announced immediately rather than queued.
      aria-live="assertive"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg',
            toast.tone === 'success' && 'border-emerald-700 bg-emerald-950 text-emerald-100',
            toast.tone === 'error' && 'border-rose-700 bg-rose-950 text-rose-100',
            toast.tone === 'info' && 'border-slate-700 bg-slate-900 text-slate-100',
          )}
        >
          {/* Status is never carried by colour alone. */}
          <span className="font-semibold" aria-hidden>
            {toast.tone === 'success' ? '✓' : toast.tone === 'error' ? '!' : 'i'}
          </span>
          <span className="flex-1">{toast.message}</span>

          {toast.action !== undefined && (
            <button
              type="button"
              className="rounded px-2 py-1 font-medium underline underline-offset-2"
              onClick={() => {
                toast.action?.onSelect()
                onDismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}

          <button
            type="button"
            aria-label="Dismiss notification"
            className="rounded px-1 text-lg leading-none opacity-70 hover:opacity-100"
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
