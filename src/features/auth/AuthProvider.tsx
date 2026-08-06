import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSupabaseClient } from '../../lib/supabase/client.ts'
import { isDemoMode } from '../../config/env.ts'
import { DEMO_USER } from '../../data/fixtures.ts'
import {
  AuthContext,
  type AppUser,
  type AuthContextValue,
  type AuthStatus,
  type PasswordRecoveryStatus,
} from './auth-context.ts'

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
  const [recoveryRequest] = useState(readPasswordRecoveryRequest)
  const [status, setStatus] = useState<AuthStatus>(isDemoMode ? 'authenticated' : 'loading')
  const [user, setUser] = useState<AppUser | null>(isDemoMode ? DEMO_USER : null)
  const [passwordRecoveryStatus, setPasswordRecoveryStatus] = useState<PasswordRecoveryStatus>(
    recoveryRequest.isRecoveryRoute ? 'loading' : 'idle',
  )
  const supabase = getSupabaseClient()

  useEffect(() => {
    if (supabase === null) {
      if (recoveryRequest.isRecoveryRoute) setPasswordRecoveryStatus('invalid')
      return
    }

    let active = true

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        const session = data.session
        setUser(session === null ? null : toAppUser(session.user))
        setStatus(session === null ? 'unauthenticated' : 'authenticated')
        if (recoveryRequest.isRecoveryRoute) {
          setPasswordRecoveryStatus(
            session !== null && recoveryRequest.hasAuthResponse ? 'ready' : 'invalid',
          )
        }
      })
      .catch(() => {
        if (!active) return
        // Never surface the underlying error: it can echo configuration values.
        setStatus('unauthenticated')
        if (recoveryRequest.isRecoveryRoute) setPasswordRecoveryStatus('invalid')
      })

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session === null ? null : toAppUser(session.user))
      setStatus(session === null ? 'unauthenticated' : 'authenticated')
      if (event === 'PASSWORD_RECOVERY') setPasswordRecoveryStatus('ready')
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [recoveryRequest, supabase])

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

  const updatePassword = useCallback<AuthContextValue['updatePassword']>(
    async (password) => {
      if (supabase === null || passwordRecoveryStatus !== 'ready') {
        return { error: 'This password recovery link is invalid or has expired.' }
      }

      const { error } = await supabase.auth.updateUser({ password })
      if (error === null) {
        setPasswordRecoveryStatus('idle')
        return { error: null }
      }

      return { error: 'Could not update the password. Request a new recovery email and try again.' }
    },
    [passwordRecoveryStatus, supabase],
  )

  const signOut = useCallback(async () => {
    if (supabase === null) return
    await supabase.auth.signOut()
    setUser(null)
    setStatus('unauthenticated')
  }, [supabase])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      passwordRecoveryStatus,
      user,
      isDemo: isDemoMode,
      signIn,
      updatePassword,
      signOut,
    }),
    [status, passwordRecoveryStatus, user, signIn, updatePassword, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function readPasswordRecoveryRequest(): {
  isRecoveryRoute: boolean
  hasAuthResponse: boolean
} {
  if (typeof window === 'undefined') {
    return { isRecoveryRoute: false, hasAuthResponse: false }
  }

  const isRecoveryRoute = window.location.pathname === '/reset-password'
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const hasAuthResponse =
    search.has('code') ||
    search.has('token_hash') ||
    search.has('error') ||
    hash.has('access_token') ||
    hash.has('type') ||
    hash.has('error')

  return { isRecoveryRoute, hasAuthResponse }
}

function toAppUser(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): AppUser {
  const displayName = user.user_metadata?.['display_name']

  return {
    id: user.id,
    email: user.email ?? null,
    displayName: typeof displayName === 'string' ? displayName : null,
  }
}
