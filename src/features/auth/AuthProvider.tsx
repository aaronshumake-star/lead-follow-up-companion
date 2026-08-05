import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSupabaseClient } from '../../lib/supabase/client.ts'
import { isDemoMode } from '../../config/env.ts'
import { DEMO_USER } from '../../data/fixtures.ts'
import { AuthContext, type AppUser, type AuthContextValue, type AuthStatus } from './auth-context.ts'

/**
 * Authentication state for the whole app.
 *
 * Two modes:
 *   - Supabase configured: real sessions, restored on load and kept in sync
 *     through onAuthStateChange.
 *   - Demo mode: a fixed fictional user, so a fresh clone is explorable and the
 *     Playwright smoke test can run without credentials.
 *
 * Demo mode is only reachable when no Supabase URL is set, so it cannot
 * accidentally shadow a real session.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabaseClient()
  const [status, setStatus] = useState<AuthStatus>(isDemoMode ? 'authenticated' : 'loading')
  const [user, setUser] = useState<AppUser | null>(isDemoMode ? DEMO_USER : null)

  useEffect(() => {
    if (supabase === null) return

    let active = true

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        const session = data.session
        setUser(session === null ? null : toAppUser(session.user))
        setStatus(session === null ? 'unauthenticated' : 'authenticated')
      })
      .catch(() => {
        if (!active) return
        // Never surface the underlying error: it can echo configuration values.
        setStatus('unauthenticated')
      })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session === null ? null : toAppUser(session.user))
      setStatus(session === null ? 'unauthenticated' : 'authenticated')
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [supabase])

  const signIn = useCallback<AuthContextValue['signIn']>(
    async (email, password) => {
      if (supabase === null) {
        return { error: 'Supabase is not configured. See README.md for setup steps.' }
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error === null) return { error: null }

      // Deliberately generic: a specific message would tell an attacker whether
      // the address exists.
      return { error: 'Could not sign in. Check the email address and password.' }
    },
    [supabase],
  )

  const signOut = useCallback(async () => {
    if (supabase === null) return
    await supabase.auth.signOut()
    setUser(null)
    setStatus('unauthenticated')
  }, [supabase])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, isDemo: isDemoMode, signIn, signOut }),
    [status, user, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function toAppUser(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): AppUser {
  const displayName = user.user_metadata?.['display_name']

  return {
    id: user.id,
    email: user.email ?? null,
    displayName: typeof displayName === 'string' ? displayName : null,
  }
}
