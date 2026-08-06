import { useContext } from 'react'
import { ToastContext, type ToastContextValue } from './toast-context.ts'

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)

  if (context === null) {
    throw new Error('useToast must be used inside a ToastProvider')
  }

  return context
}
