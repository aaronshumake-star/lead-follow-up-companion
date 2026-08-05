import { expect, test } from '@playwright/test'

/**
 * Phase 1 smoke coverage: the shell boots, every placeholder route renders, and
 * the no-next-action queue is the first thing on the dashboard.
 */
test.describe('application shell', () => {
  test('opens on the dashboard with the no-next-action queue visible', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No next action' })).toBeVisible()

    // The two seeded customers with nothing scheduled must be surfaced.
    const queue = page.locator('section').filter({ hasText: 'No next action' })
    await expect(queue.getByText('Renata Okonkwo')).toBeVisible()
    await expect(queue.getByText('Travis Lindqvist')).toBeVisible()
  })

  test('navigates to every placeholder page', async ({ page }) => {
    await page.goto('/')

    for (const [link, heading] of [
      ['Customers', 'Customers'],
      ['Follow-Ups', 'Follow-Ups'],
      ['Screenshot Inbox', 'Screenshot Inbox'],
      ['WhatsApp', 'WhatsApp'],
      ['Settings', 'Settings'],
    ] as const) {
      await page.getByRole('link', { name: link, exact: true }).click()
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    }
  })

  test('reports every provider as unconfigured', async ({ page }) => {
    await page.goto('/settings')

    const providers = page.locator('section').filter({ hasText: 'Providers' })
    await expect(providers.getByText('Not configured').first()).toBeVisible()
    await expect(providers.getByText('Disabled')).toBeVisible()
  })

  test('serves a web app manifest for installability', async ({ page, request }) => {
    await page.goto('/')

    const response = await request.get('/manifest.webmanifest')
    expect(response.ok()).toBe(true)

    const manifest = (await response.json()) as { name: string; icons: unknown[] }
    expect(manifest.name).toBe('Lead Follow-Up Companion')
    expect(manifest.icons.length).toBeGreaterThan(0)
  })
})
