import { createContext } from 'react'

export interface AppUser {
  id: string
  email: string | null
  displayName: string | null
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'
export type PasswordRecoveryStatus = 'idle' | 'loading' | 'ready' | 'invalid'

export interface AuthContextValue {
  status: AuthStatus
  passwordRecoveryStatus: PasswordRecoveryStatus
  user: AppUser | null
  /** True when running against fixtures with no Supabase project attached. */
  isDemo: boolean
  signIn(email: string, password: string): Promise<{ error: string | null }>
  updatePassword(password: string): Promise<{ error: string | null }>
  signOut(): Promise<void>
}

/**
 * Split from the provider component so the module exports only a value, which
 * keeps React Fast Refresh working on the provider file.
 */
export const AuthContext = createContext<AuthContextValue | null>(null)
