/**
 * Rendering helpers for component tests.
 *
 * Tests run in demo mode against browser-local storage, so they exercise the
 * same repository, the same domain rules and the same async loading path the
 * app uses. Nothing here stubs the data layer.
 */

import type { ReactElement, ReactNode } from 'react'
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../features/auth/AuthProvider.tsx'
import { ToastProvider } from '../components/ui/ToastProvider.tsx'
import { WorkspaceProvider } from '../data/WorkspaceProvider.tsx'

export function AppProviders({
  children,
  initialPath = '/',
}: {
  children: ReactNode
  initialPath?: string
}) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <ToastProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>
  )
}

/** Renders a component with every provider the app supplies. */
export function renderWithProviders(ui: ReactElement, initialPath = '/') {
  return render(<AppProviders initialPath={initialPath}>{ui}</AppProviders>)
}

/**
 * Waits for the workspace to finish its first load.
 *
 * The loading state is a live region, so waiting for it to disappear is more
 * reliable than waiting for any particular piece of content to appear.
 */
export async function waitForWorkspace(): Promise<void> {
  const loaders = screen.queryAllByRole('status')
  const loading = loaders.find((element) => /loading/i.test(element.textContent ?? ''))

  if (loading !== undefined) {
    await waitForElementToBeRemoved(loading, { timeout: 5000 })
  }
}
