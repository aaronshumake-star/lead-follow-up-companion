import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from './useAuth.ts'
import { env, isSupabaseConfigured } from '../../config/env.ts'

interface LocationState {
  from?: string
}

/**
 * Sign-in for a single-user application.
 *
 * There is no sign-up form on purpose: the one account is created in the
 * Supabase dashboard and public signups are turned off, which removes the whole
 * category of unwanted accounts on a project that should only ever have one.
 */
export function SignInPage() {
  const { status, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') {
    const state = location.state as LocationState | null
    return <Navigate to={state?.from ?? '/'} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await signIn(email, password)
    setSubmitting(false)
    if (result.error !== null) setError(result.error)
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-slate-100">{env.VITE_APP_NAME}</h1>
        <p className="mt-1 text-sm text-slate-400">
          Private follow-up companion. Sign in to reach your leads.
        </p>

        {!isSupabaseConfigured && (
          <p
            role="status"
            className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200"
          >
            Supabase is not configured, so sign-in is unavailable. See README.md for setup steps.
          </p>
        )}

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-300">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-600"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
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
            disabled={submitting || !isSupabaseConfigured}
            className="w-full rounded-lg bg-sky-600 px-3 py-2 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
