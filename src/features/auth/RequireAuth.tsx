import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from './useAuth.ts'

/**
 * Route guard for everything behind sign-in.
 *
 * This is a usability boundary, not the security boundary — Row Level Security
 * in PostgreSQL is what actually protects the data. Hiding a route in the
 * browser protects nothing on its own.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div
        className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-400"
        role="status"
        aria-live="polite"
      >
        Checking your session…
      </div>
    )
  }

  if (status === 'unauthenticated') {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
