import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { DashboardPage } from './DashboardPage.tsx'
import { renderWithProviders, waitForWorkspace } from '../../test-support/render.tsx'

describe('DashboardPage', () => {
  it('gives the no-next-action queue its own prominent section', async () => {
    renderWithProviders(<DashboardPage />)
    await waitForWorkspace()

    expect(screen.getByRole('heading', { name: /no next action/i })).toBeInTheDocument()
  })

  it('lists the seeded customers that have nothing scheduled', async () => {
    renderWithProviders(<DashboardPage />)
    await waitForWorkspace()

    const heading = screen.getByRole('heading', { name: /^no next action$/i })
    const section = heading.closest('section')
    expect(section).not.toBeNull()

    const queue = within(section as HTMLElement)
    expect(queue.getByText('Renata Okonkwo')).toBeInTheDocument()
    expect(queue.getByText('Travis Lindqvist')).toBeInTheDocument()

    // A customer with a scheduled follow-up must not appear here.
    expect(queue.queryByText('Jesus Ayala')).not.toBeInTheDocument()
  })

  it('shows scheduled work separately from forgotten leads', async () => {
    renderWithProviders(<DashboardPage />)
    await waitForWorkspace()

    const heading = screen.getByRole('heading', { name: /^due tomorrow$/i })
    const scheduled = within(heading.closest('section') as HTMLElement)

    // Jesus Ayala is seeded with a follow-up tomorrow at ten.
    expect(scheduled.getByText('Jesus Ayala')).toBeInTheDocument()
    expect(scheduled.queryByText('Renata Okonkwo')).not.toBeInTheDocument()
  })

  it('surfaces the overdue lead and keeps it visible', async () => {
    renderWithProviders(<DashboardPage />)
    await waitForWorkspace()

    const heading = screen.getByRole('heading', { name: /^overdue$/i })
    const overdue = within(heading.closest('section') as HTMLElement)

    // Priya Raghunathan is seeded two days overdue.
    expect(overdue.getByText('Priya Raghunathan')).toBeInTheDocument()
  })

  it('lists every required queue', async () => {
    renderWithProviders(<DashboardPage />)
    await waitForWorkspace()

    for (const title of [
      /^action required now$/i,
      /^overdue$/i,
      /^due today$/i,
      /^due tomorrow$/i,
      /^waiting for customer$/i,
      /^no next action$/i,
      /^upcoming appointments$/i,
      /^recently added$/i,
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
  })
})
