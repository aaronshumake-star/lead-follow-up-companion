import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider.tsx'
import { useAuth } from './useAuth.ts'

const authMocks = vi.hoisted(() => {
  let callback: ((event: string, session: unknown) => void) | undefined

  return {
    getSession: vi.fn(),
    signInWithPassword: vi.fn(),
    updateUser: vi.fn(),
    onAuthStateChange: vi.fn((nextCallback: (event: string, session: unknown) => void) => {
      callback = nextCallback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    }),
    emit(event: string, session: unknown) {
      callback?.(event, session)
    },
  }
})

vi.mock('../../config/env.ts', () => ({
  env: {
    VITE_DEFAULT_TIME_ZONE: 'America/Chicago',
  },
  isDemoMode: false,
}))

vi.mock('../../lib/supabase/client.ts', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: authMocks.getSession,
      signInWithPassword: authMocks.signInWithPassword,
      updateUser: authMocks.updateUser,
      onAuthStateChange: authMocks.onAuthStateChange,
    },
  }),
}))

function RecoveryState() {
  const { passwordRecoveryStatus } = useAuth()
  return <p>{passwordRecoveryStatus}</p>
}

describe('AuthProvider password recovery', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/reset-password#type=recovery&access_token=valid')
    authMocks.getSession.mockReturnValue(new Promise(() => undefined))
  })

  it('detects the Supabase PASSWORD_RECOVERY event', async () => {
    render(
      <AuthProvider>
        <RecoveryState />
      </AuthProvider>,
    )

    act(() => {
      authMocks.emit('PASSWORD_RECOVERY', {
        user: { id: 'user-1', email: 'owner@example.com', user_metadata: {} },
      })
    })

    expect(await screen.findByText('ready')).toBeInTheDocument()
  })
})
