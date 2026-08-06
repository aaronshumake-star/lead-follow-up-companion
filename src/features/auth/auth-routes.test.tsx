import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from './auth-context.ts'
import { AuthCallbackPage } from './AuthCallbackPage.tsx'
import { ResetPasswordPage } from './ResetPasswordPage.tsx'
import { SignInPage } from './SignInPage.tsx'

const defaultAuth: AuthContextValue = {
  status: 'unauthenticated',
  passwordRecoveryStatus: 'idle',
  user: null,
  isDemo: false,
  signIn: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
  signOut: async () => undefined,
}

function renderRoute(path: string, page: ReactNode, auth: Partial<AuthContextValue> = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={{ ...defaultAuth, ...auth }}>
        <Routes>
          <Route path="/" element={<h1>Dashboard</h1>} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/reset-password" element={page} />
          <Route path="/auth/callback" element={page} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('Supabase email auth routes', () => {
  it('updates the password for a verified PASSWORD_RECOVERY session', async () => {
    const user = userEvent.setup()
    const updatePassword = vi.fn().mockResolvedValue({ error: null })
    renderRoute('/reset-password#type=recovery&access_token=valid', <ResetPasswordPage />, {
      status: 'authenticated',
      passwordRecoveryStatus: 'ready',
      updatePassword,
    })

    await user.type(screen.getByLabelText('New password'), 'new-password-123')
    await user.type(screen.getByLabelText('Confirm new password'), 'new-password-123')
    await user.click(screen.getByRole('button', { name: 'Update password' }))

    expect(updatePassword).toHaveBeenCalledWith('new-password-123')
    expect(await screen.findByText(/password was updated successfully/i)).toBeInTheDocument()
    expect(screen.getByText(/redirecting to the dashboard/i)).toBeInTheDocument()
  })

  it('redirects an established magic-link session to the Dashboard', () => {
    renderRoute('/auth/callback#type=magiclink&access_token=valid', <AuthCallbackPage />, {
      status: 'authenticated',
    })

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('explains when an email link has expired', () => {
    renderRoute(
      '/auth/callback#error=access_denied&error_code=otp_expired',
      <AuthCallbackPage />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/link has expired/i)
  })

  it('rejects an invalid email link', () => {
    renderRoute('/reset-password#error=access_denied&error_code=bad_code', <ResetPasswordPage />)

    expect(screen.getByRole('alert')).toHaveTextContent(/link is invalid/i)
  })

  it('preserves normal email and password sign-in', async () => {
    const user = userEvent.setup()
    const signIn = vi.fn().mockResolvedValue({ error: null })
    renderRoute('/sign-in', <SignInPage />, { signIn })

    await user.type(screen.getByLabelText('Email'), 'owner@example.com')
    await user.type(screen.getByLabelText('Password'), 'existing-password')
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!)

    expect(signIn).toHaveBeenCalledWith('owner@example.com', 'existing-password')
  })
})
