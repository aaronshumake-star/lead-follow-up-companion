import { expect, test, type Page } from '@playwright/test'

/**
 * The full manual workflow, end to end, against the demo-mode production build.
 *
 * This is the sequence the app exists to support: create a customer, record a
 * call that went unanswered, watch the follow-up land in the right dashboard
 * queue, complete it, record a text, park the customer as waiting, and confirm
 * the response deadline behaves.
 *
 * Demo records live in localStorage, and each Playwright test gets a fresh
 * browser context, so every run starts from the seeded fixtures.
 */

const CUSTOMER = 'Wendell Braithwaite'

async function fillField(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value)
}

/**
 * Scopes to a card by its heading rather than by its text.
 *
 * Filtering on text is ambiguous here: "Waiting for customer" is both a queue
 * title and a status badge that appears on cards in other queues.
 */
function section(page: Page, heading: string | RegExp) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) })
}

async function createCustomer(page: Page, fullName = CUSTOMER) {
  await page.goto('/customers')
  await page.getByRole('button', { name: 'New customer' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Full name', { exact: true }).fill(fullName)
  await dialog.getByLabel('Phone', { exact: true }).fill('(555) 010-0777')
  await dialog.getByLabel('Email', { exact: true }).fill('wendell@example.com')
  await dialog.getByLabel('City', { exact: true }).fill('Abilene')
  await dialog.getByLabel('State', { exact: true }).fill('TX')

  await dialog.getByRole('button', { name: 'Create customer' }).click()
  await expect(dialog).toBeHidden()
}

async function openCustomer(page: Page, fullName = CUSTOMER) {
  await page.goto('/customers')
  await page.getByLabel('Search', { exact: true }).fill(fullName)
  await page.getByRole('link', { name: fullName }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: fullName })).toBeVisible()
}

test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('shows all eight dashboard tiles without horizontal scrolling', async ({ page }) => {
    await page.goto('/')

    const summary = page.getByLabel('Queue summary')
    await expect(summary).toBeVisible()

    for (const label of [
      'Action Required Now',
      'Overdue',
      'Due Today',
      'Due Tomorrow',
      'Waiting for Customer',
      'No Next Action',
      'Upcoming Appointments',
      'Needs Review',
    ]) {
      await expect(summary.getByText(label, { exact: true })).toBeVisible()
    }

    // Every tile has to sit inside the viewport, not past its right edge.
    const tiles = await summary.locator('> div').all()
    expect(tiles).toHaveLength(8)

    for (const tile of tiles) {
      const box = await tile.boundingBox()
      expect(box).not.toBeNull()
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(1920)
    }

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflows).toBe(false)
  })

  test('offers a visible New customer button that opens the dialog', async ({ page }) => {
    await page.goto('/customers')

    const newCustomer = page.getByRole('button', { name: 'New customer' })
    await expect(newCustomer).toBeVisible()
    await expect(newCustomer).toBeInViewport()

    await newCustomer.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'New customer' })).toBeVisible()
  })

  test('no page claims to be a read-only preview any more', async ({ page }) => {
    for (const path of ['/', '/customers', '/follow-ups', '/screenshots', '/whatsapp', '/settings']) {
      await page.goto(path)
      await expect(page.getByText(/read-only preview/i)).toHaveCount(0)
      await expect(page.getByText(/^Phase 1$/)).toHaveCount(0)
    }
  })
})

test.describe('manual lead tracking workflow', () => {
  test('creates a customer and records the entered phone and email as channels', async ({ page }) => {
    await createCustomer(page)
    await openCustomer(page)

    const coverage = section(page, 'Contact coverage')
    await expect(coverage.getByText('Phone call').first()).toBeVisible()
    await expect(coverage.getByText('Email').first()).toBeVisible()

    // Nothing has been attempted yet, so the coverage must say so plainly.
    await expect(coverage.getByText('Nothing tried yet')).toBeVisible()
  })

  test('a new customer with no follow-up lands in the no-next-action queue', async ({ page }) => {
    await createCustomer(page)

    await page.goto('/')
    const queue = section(page, /^No next action$/)
    await expect(queue.getByText(CUSTOMER)).toBeVisible()
  })

  test('logs a no-answer call, schedules the follow-up, then completes it', async ({ page }) => {
    await createCustomer(page)
    await openCustomer(page)

    await page.getByRole('button', { name: 'Called — no answer' }).click()

    // The toast reports what was logged and what was scheduled.
    await expect(page.getByRole('status').filter({ hasText: 'Called — no answer' })).toBeVisible()

    // The call now counts as a personal attempt on the phone channel.
    const coverage = section(page, 'Contact coverage')
    await expect(coverage.getByText('1 total')).toBeVisible()

    // A follow-up now exists, so the customer is no longer forgotten.
    await page.goto('/')
    const forgotten = section(page, /^No next action$/)
    await expect(forgotten.getByText(CUSTOMER)).toHaveCount(0)

    // Completing it without scheduling anything returns them to the queue.
    await openCustomer(page)
    await page.getByRole('button', { name: 'Complete', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Follow-up completed' })).toBeVisible()

    await page.goto('/')
    await expect(section(page, /^No next action$/).getByText(CUSTOMER)).toBeVisible()
  })

  test('marks a customer waiting with a response deadline that is not a dead end', async ({ page }) => {
    await createCustomer(page)
    await openCustomer(page)

    await page.getByRole('button', { name: 'Sent text' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Sent text' })).toBeVisible()

    await page.getByRole('button', { name: 'Waiting for customer' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Waiting always has a deadline/i)).toBeVisible()
    await dialog.getByLabel('Waiting for what?', { exact: true }).fill('Financing decision')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    // The waiting queue shows the deadline and when it returns to action.
    await page.goto('/')
    const waiting = section(page, /^Waiting for customer$/)
    await expect(waiting.getByText(CUSTOMER)).toBeVisible()

    await openCustomer(page)
    await expect(page.getByText(/Response deadline/i)).toBeVisible()
  })

  test('warns about a possible duplicate without merging anything', async ({ page }) => {
    await createCustomer(page)

    await page.goto('/customers')
    await page.getByRole('button', { name: 'New customer' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Full name', { exact: true }).fill('Wendell B')
    await dialog.getByLabel('Phone', { exact: true }).fill('555-010-0777')

    await dialog.getByRole('button', { name: 'Check for duplicates' }).click()

    const warning = dialog.getByRole('region', { name: 'Possible duplicates' })
    await expect(warning).toBeVisible()
    await expect(warning.getByText('Same phone number')).toBeVisible()
    await expect(warning.getByRole('button', { name: 'Open existing customer' })).toBeVisible()

    // Continuing creates a separate record; nothing is merged.
    await dialog.getByRole('button', { name: 'Create customer' }).click()
    await expect(dialog).toBeHidden()

    await page.getByLabel('Search', { exact: true }).fill('Wendell')
    await expect(page.getByRole('link', { name: CUSTOMER })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Wendell B', exact: true })).toBeVisible()
  })

  test('requires confirmation before marking a customer lost', async ({ page }) => {
    await createCustomer(page)
    await openCustomer(page)

    await page.getByRole('button', { name: 'Mark lost' }).click()

    const confirm = page.getByRole('dialog')
    await expect(confirm).toBeVisible()
    await expect(confirm.getByText(/drop out of the active queues/i)).toBeVisible()
    await confirm.getByRole('button', { name: 'Mark lost' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'marked lost' })).toBeVisible()

    // A lost customer is excluded from the active queues.
    await page.goto('/')
    await expect(section(page, /^No next action$/).getByText(CUSTOMER)).toHaveCount(0)
  })

  test('archives and restores a customer', async ({ page }) => {
    await createCustomer(page)
    await openCustomer(page)

    await page.getByRole('button', { name: 'Archive' }).click()
    const confirm = page.getByRole('dialog')
    await confirm.getByRole('button', { name: 'Archive' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'archived' })).toBeVisible()

    await expect(page.getByText('This customer is archived.')).toBeVisible()
    await page.getByRole('button', { name: 'Restore to working' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'restored' })).toBeVisible()
  })

  test('corrects an activity and marks it as edited', async ({ page }) => {
    await createCustomer(page)
    await openCustomer(page)

    await page.getByRole('button', { name: 'Called — no answer' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Called — no answer' })).toBeVisible()

    const timeline = section(page, 'Activity timeline')
    await timeline.getByRole('button', { name: 'Correct' }).first().click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Outcome', { exact: true }).selectOption('connected')
    await dialog.getByLabel('Reason for the correction', { exact: true }).fill('Logged the wrong outcome')
    await dialog.getByRole('button', { name: 'Save correction' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'audit log' })).toBeVisible()
    await expect(timeline.getByText('Edited').first()).toBeVisible()
  })

  test('searches by RV details and filters by follow-up state', async ({ page }) => {
    await page.goto('/customers')

    // Seeded fixture: Jesus Ayala is interested in a Cedar Ridge 28BHS.
    await page.getByLabel('Search', { exact: true }).fill('28BHS')
    await expect(page.getByRole('link', { name: 'Jesus Ayala' })).toBeVisible()

    await page.getByLabel('Search', { exact: true }).fill('')
    await page.getByRole('button', { name: 'Filters' }).click()
    await page.getByLabel('Follow-up state', { exact: true }).selectOption('no_next_action')

    await expect(page.getByRole('link', { name: 'Renata Okonkwo' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Jesus Ayala' })).toHaveCount(0)
  })

  test('saves a scheduling preference in settings', async ({ page }) => {
    await page.goto('/settings')

    await fillField(page, 'Call with no answer', '6')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved' })).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Call with no answer', { exact: true })).toHaveValue('6')
  })
})
