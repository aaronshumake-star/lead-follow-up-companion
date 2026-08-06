import { createContext } from 'react'

export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  tone: ToastTone
  message: string
  /** Optional single action, e.g. "Undo" or "Open customer". */
  action?: { label: string; onSelect: () => void }
}

export interface ToastContextValue {
  toasts: Toast[]
  /** Routine confirmations use this instead of interrupting with a dialog. */
  notify(tone: ToastTone, message: string, action?: Toast['action']): void
  dismiss(id: string): void
}

export const ToastContext = createContext<ToastContextValue | null>(null)
