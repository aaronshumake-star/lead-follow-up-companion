import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { App } from './App.tsx'

/**
 * With no Supabase credentials in the test environment the app runs in demo
 * mode, so these cover the shell, routing and the placeholder pages without
 * needing a project.
 */
function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App', () => {
  it('renders the dashboard behind the authenticated shell', () => {
    renderApp()

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })

  it('says plainly that the data on screen is fictional', () => {
    renderApp()

    expect(screen.getByText(/demo mode/i)).toBeInTheDocument()
  })

  it.each([
    ['/customers', 'Customers'],
    ['/follow-ups', 'Follow-Ups'],
    ['/screenshots', 'Screenshot Inbox'],
    ['/whatsapp', 'WhatsApp'],
    ['/settings', 'Settings'],
  ])('renders %s', (path, title) => {
    renderApp(path)

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  })

  it('sends an unknown path back to the dashboard', () => {
    renderApp('/nonexistent')

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
  })

  it('navigates between pages from the sidebar', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole('link', { name: 'Follow-Ups' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Follow-Ups' })).toBeInTheDocument()
  })

  it('shows every provider as unconfigured on the settings page', () => {
    renderApp('/settings')

    expect(screen.getByRole('heading', { name: /providers/i })).toBeInTheDocument()
    expect(screen.getAllByText('Not configured').length).toBeGreaterThan(0)
  })
})
