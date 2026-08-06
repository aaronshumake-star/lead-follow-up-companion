import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useAuth } from './useAuth.ts'
import { AuthLinkError } from './AuthLinkError.tsx'
import { getAuthLinkError } from './auth-link.ts'

export function ResetPasswordPage() {
  const { passwordRecoveryStatus, updatePassword } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const linkError = getAuthLinkError(location.search, location.hash)

  useEffect(() => {
    if (!succeeded) return

    const redirect = window.setTimeout(() => navigate('/', { replace: true }), 1500)
    return () => window.clearTimeout(redirect)
  }, [navigate, succeeded])

  if (succeeded) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4">
        <p
          role="status"
          className="w-full max-w-sm rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-3 text-sm text-emerald-200"
        >
          Your password was updated successfully. Redirecting to the Dashboard…
        </p>
      </main>
    )
  }

  if (linkError !== null) return <AuthLinkError message={linkError.message} />

  if (passwordRecoveryStatus === 'loading') {
    return (
      <main
        role="status"
        className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-400"
      >
        Verifying your recovery link…
      </main>
    )
  }

  if (passwordRecoveryStatus !== 'ready') {
    return (
      <AuthLinkError message="This password recovery link is invalid or has expired. Request a new recovery email and try again." />
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }

    setSubmitting(true)
    const result = await updatePassword(newPassword)
    setSubmitting(false)

    if (result.error !== null) {
      setError(result.error)
      return
    }

    setSucceeded(true)
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-slate-100">Set a new password</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter the new password you will use to sign in.
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-slate-300">
              New password
            </label>
            <input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-300">
              Confirm new password
            </label>
            <input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100"
            />
          </div>

          {error !== null && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-sky-600 px-3 py-2 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Updating password…' : 'Update password'}
          </button>
        </form>
      </div>
    </main>
  )
}
