import { Navigate, useLocation } from 'react-router'
import { useAuth } from './useAuth.ts'
import { AuthLinkError } from './AuthLinkError.tsx'
import { getAuthLinkError } from './auth-link.ts'

export function AuthCallbackPage() {
  const { status } = useAuth()
  const location = useLocation()
  const linkError = getAuthLinkError(location.search, location.hash)

  if (linkError !== null) return <AuthLinkError message={linkError.message} />
  if (status === 'authenticated') return <Navigate to="/" replace />

  if (status === 'loading') {
    return (
      <main
        role="status"
        className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-400"
      >
        Completing your sign-in…
      </main>
    )
  }

  return (
    <AuthLinkError message="This magic link is invalid or has expired. Request a new magic link and try again." />
  )
}
