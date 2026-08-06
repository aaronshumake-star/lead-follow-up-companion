import { Navigate, useLocation } from 'react-router'
import { useAuth } from './useAuth.ts'
import { getAuthLinkError } from './auth-link.ts'

/**
 * Emails sent from Supabase Dashboard use the Site URL and do not accept a
 * per-message redirect. Route the recovery event to the reset screen even when
 * that dashboard-generated link lands at the production root.
 */
export function PasswordRecoveryRedirect() {
  const { passwordRecoveryStatus } = useAuth()
  const location = useLocation()
  const isAuthRoute =
    location.pathname === '/reset-password' || location.pathname === '/auth/callback'

  if (!isAuthRoute && getAuthLinkError(location.search, location.hash) !== null) {
    return <Navigate to={`/auth/callback${location.search}${location.hash}`} replace />
  }

  if (passwordRecoveryStatus === 'ready' && location.pathname !== '/reset-password') {
    return <Navigate to="/reset-password" replace />
  }

  return null
}
