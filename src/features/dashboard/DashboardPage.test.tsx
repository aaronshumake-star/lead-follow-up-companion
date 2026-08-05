import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DashboardPage } from './DashboardPage.tsx'

describe('DashboardPage', () => {
  it('gives the no-next-action queue its own prominent section', () => {
    render(<DashboardPage />)

    expect(screen.getByRole('heading', { name: /no next action/i })).toBeInTheDocument()
  })

  it('lists the seeded customers that have nothing scheduled', () => {
    render(<DashboardPage />)

    const heading = screen.getByRole('heading', { name: /^no next action$/i })
    const section = heading.closest('section')
    expect(section).not.toBeNull()

    const queue = within(section as HTMLElement)
    expect(queue.getByText('Renata Okonkwo')).toBeInTheDocument()
    expect(queue.getByText('Travis Lindqvist')).toBeInTheDocument()

    // A customer with a scheduled follow-up must not appear here.
    expect(queue.queryByText('Jesus Ayala')).not.toBeInTheDocument()
  })

  it('shows scheduled work separately from forgotten leads', () => {
    render(<DashboardPage />)

    const heading = screen.getByRole('heading', { name: /scheduled work/i })
    const scheduled = within(heading.closest('section') as HTMLElement)

    expect(scheduled.getByText('Jesus Ayala')).toBeInTheDocument()
    expect(scheduled.getByText('Priya Raghunathan')).toBeInTheDocument()
    expect(scheduled.queryByText('Renata Okonkwo')).not.toBeInTheDocument()
  })
})
