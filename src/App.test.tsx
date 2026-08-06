import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { App } from './App.tsx'
import { waitForWorkspace } from './test-support/render.tsx'

/**
 * With no Supabase credentials in the test environment the app runs in demo
 * mode, so these cover the shell, routing and the pages without needing a
 * project.
 */
function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App', () => {
  it('renders the dashboard behind the authenticated shell', async () => {
    renderApp()
    await waitForWorkspace()

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })

  it('says plainly that the data on screen is fictional and local', async () => {
    renderApp()
    await waitForWorkspace()

    expect(screen.getByText(/demo mode/i)).toBeInTheDocument()
    expect(screen.getByText(/stored in this browser only/i)).toBeInTheDocument()
  })

  it.each([
    ['/customers', 'Customers'],
    ['/follow-ups', 'Follow-Ups'],
    ['/screenshots', 'Screenshot Inbox'],
    ['/whatsapp', 'WhatsApp'],
    ['/settings', 'Settings'],
  ])('renders %s', async (path, title) => {
    renderApp(path)
    await waitForWorkspace()

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  })

  it('sends an unknown path back to the dashboard', async () => {
    renderApp('/nonexistent')
    await waitForWorkspace()

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
  })

  it('navigates between pages from the sidebar', async () => {
    const user = userEvent.setup()
    renderApp()
    await waitForWorkspace()

    await user.click(screen.getByRole('link', { name: 'Follow-Ups' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Follow-Ups' })).toBeInTheDocument()
  })

  it('shows provider status and confirms nothing can bill from the browser', async () => {
    renderApp('/settings')
    await waitForWorkspace()

    expect(await screen.findByRole('heading', { name: /providers/i })).toBeInTheDocument()
    // OCR and command parsing are configured from Phase 3, but everything the
    // browser can reach is free; the billable WhatsApp client is server-only.
    expect(screen.getAllByText('no cost').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('can bill')).toHaveLength(0)
  })
})
