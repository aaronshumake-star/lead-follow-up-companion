import { expect, test, type Page } from '@playwright/test'

/**
 * The Phase 3 workflows against the demo-mode production build.
 *
 * Demo mode uses a deterministic OCR fixture and a simulated WhatsApp
 * transport, so these run with no credentials, no network and no cost — but
 * the decision engine, the import planner, the reminder planner with its
 * idempotency keys and the command parser are all the real ones.
 */

/** A tiny valid PNG, so intake validation sees genuine magic bytes. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAOklEQVR4nO3BMQEAAADCoPVPbQwf' +
  'oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwbXgAAAV5F+xAAAAAASUVORK5CYII='

function section(page: Page, heading: string | RegExp) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) })
}

/**
 * Drops a PNG onto the intake area.
 *
 * Uses setInputFiles on the hidden picker rather than synthesising a paste
 * event: it exercises the same handler and is stable across browsers.
 */
async function dropScreenshot(page: Page, filename = 'crm-capture.png') {
  await page.setInputFiles('input[type="file"]', {
    name: filename,
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
}

async function chooseScenario(page: Page, label: string | RegExp) {
  await page.getByLabel('Scenario', { exact: true }).selectOption({ label: await labelFor(page, label) })
}

async function labelFor(page: Page, needle: string | RegExp): Promise<string> {
  const options = await page.getByLabel('Scenario', { exact: true }).locator('option').allTextContents()
  const match = options.find((option) =>
    typeof needle === 'string' ? option.includes(needle) : needle.test(option),
  )

  if (match === undefined) throw new Error(`no scenario option matching ${String(needle)}`)
  return match
}

test.describe('screenshot intake', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/screenshots')
    await expect(page.getByRole('heading', { level: 1, name: 'Screenshot Inbox' })).toBeVisible()
  })

  test('shows the intake area with paste, drag and file picker', async ({ page }) => {
    const dropzone = page.getByTestId('screenshot-dropzone')

    await expect(dropzone).toBeVisible()
    await expect(dropzone.getByText(/Paste a screenshot with Ctrl\+V/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose file' })).toBeVisible()
  })

  test('creates a new customer automatically from a clear capture', async ({ page }) => {
    await chooseScenario(page, 'New customer')
    await dropScreenshot(page)

    await expect(page.getByText('Customer created').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /Imported Wanda Petrossian/i })).toBeVisible()
    // An imported lead must never be left without a next action.
    await expect(page.getByText(/Follow-up scheduled/i).first()).toBeVisible()

    await page.goto('/customers')
    await page.getByLabel('Search', { exact: true }).fill('Petrossian')
    await expect(page.getByRole('link', { name: 'Wanda Petrossian' })).toBeVisible()
  })

  test('updates an existing customer matched on dealership ID', async ({ page }) => {
    await chooseScenario(page, 'Existing customer')
    await dropScreenshot(page)

    await expect(page.getByText('Existing customer updated').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /Imported Jesus Ayala/i })).toBeVisible()
  })

  test('sends a conflicting phone to Needs Review instead of overwriting', async ({ page }) => {
    await chooseScenario(page, 'Conflicting phone')
    await dropScreenshot(page)

    await expect(page.getByText(/Needs review — conflicting details/i).first()).toBeVisible({
      timeout: 15_000,
    })

    const review = section(page, 'Needs Review')
    await expect(review.getByText(/verified identifier disagrees/i)).toBeVisible()
  })

  test('sends a name-only match to Needs Review and never merges', async ({ page }) => {
    await chooseScenario(page, 'Name matches only')
    await dropScreenshot(page)

    await expect(page.getByText(/Needs review — which customer\?/i).first()).toBeVisible({
      timeout: 15_000,
    })

    const review = section(page, 'Needs Review')
    await expect(review.getByText(/Only a name matches/i)).toBeVisible()
    await expect(review.getByRole('button', { name: 'Create new customer' }).first()).toBeVisible()
  })

  test('refuses a capture containing two customers', async ({ page }) => {
    await chooseScenario(page, 'Two customers visible')
    await dropScreenshot(page)

    await expect(section(page, 'Needs Review').getByText(/more than one customer/i)).toBeVisible({
      timeout: 15_000,
    })
  })

  test('reports an unreadable capture rather than guessing', async ({ page }) => {
    await chooseScenario(page, 'Unreadable capture')
    await dropScreenshot(page)

    await expect(page.getByText(/Could not read this screenshot/i).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('ignores the same screenshot pasted twice', async ({ page }) => {
    await chooseScenario(page, 'New customer')
    await dropScreenshot(page)
    await expect(page.getByText('Customer created').first()).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Paste another' }).click()
    await dropScreenshot(page)

    await expect(page.getByText('Already imported').first()).toBeVisible({ timeout: 15_000 })
  })

  test('resolves a review item onto an existing customer', async ({ page }) => {
    await chooseScenario(page, 'Conflicting phone')
    await dropScreenshot(page)

    const review = section(page, 'Needs Review')
    await expect(review.getByText(/verified identifier disagrees/i)).toBeVisible({ timeout: 15_000 })

    await review.getByRole('button', { name: 'Keep existing fields' }).first().click()
    await expect(page.getByRole('status').filter({ hasText: /Existing values kept/i })).toBeVisible()
  })

  test('offers the OCR correction fields inline', async ({ page }) => {
    await chooseScenario(page, 'Name matches only')
    await dropScreenshot(page)

    const review = section(page, 'Needs Review')
    await expect(review.getByRole('button', { name: 'Correct the reading' }).first()).toBeVisible({
      timeout: 15_000,
    })

    await review.getByRole('button', { name: 'Correct the reading' }).first().click()
    await expect(review.getByLabel('full name', { exact: true })).toBeVisible()
  })

  test('discards a screenshot from review', async ({ page }) => {
    await chooseScenario(page, 'Unreadable capture')
    await dropScreenshot(page)

    const review = section(page, 'Needs Review')
    await expect(review.getByRole('button', { name: 'Discard screenshot' }).first()).toBeVisible({
      timeout: 15_000,
    })

    await review.getByRole('button', { name: 'Discard screenshot' }).first().click()
    await expect(page.getByRole('status').filter({ hasText: /Discarded/i })).toBeVisible()
  })

  test('states that screenshot text is data, never instructions', async ({ page }) => {
    await expect(page.getByText(/data to interpret, never an instruction/i)).toBeVisible()
    await expect(page.getByText(/never as something you did/i)).toBeVisible()
  })
})

test.describe('WhatsApp reminders and commands', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/whatsapp')
    await expect(page.getByRole('heading', { level: 1, name: 'WhatsApp' })).toBeVisible()
  })

  test('labels simulated activity clearly', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Simulated WhatsApp' })).toBeVisible()
    await expect(page.getByText(/Nothing here reaches WhatsApp/i)).toBeVisible()
  })

  test('sends a reminder once and suppresses it on the second run', async ({ page }) => {
    await page.getByRole('button', { name: 'Run reminder cycle' }).click()
    await expect(page.getByRole('status').filter({ hasText: /sent/ })).toBeVisible()

    const cycle = section(page, 'Reminder cycle')
    await expect(cycle.getByText(/FOLLOW-UP/).first()).toBeVisible()

    // The second run finds every idempotency key already claimed.
    await page.getByRole('button', { name: 'Run reminder cycle' }).click()
    await expect(cycle.getByText(/Suppressed as duplicates/i)).toBeVisible()
    await expect(cycle.getByText(/idempotency key already claimed/i).first()).toBeVisible()
  })

  test('applies a text command from the approved number', async ({ page }) => {
    await page
      .getByLabel('Message', { exact: true })
      .fill('Called Jesus Ayala, no answer. Follow up tomorrow at ten.')
    await page.getByRole('button', { name: 'Send message' }).click()

    const conversation = page.getByTestId('whatsapp-conversation')
    await expect(conversation.getByText(/Updated Jesus Ayala/i)).toBeVisible()
    await expect(conversation.getByText(/Called — no answer/i)).toBeVisible()
  })

  test('rejects an unknown sender without revealing anything', async ({ page }) => {
    await page.getByRole('button', { name: 'Use an unknown number' }).click()
    await page.getByLabel('Message', { exact: true }).fill('What is overdue?')
    await page.getByRole('button', { name: 'Send message' }).click()

    const conversation = page.getByTestId('whatsapp-conversation')
    await expect(conversation.getByText(/not authorised/i)).toBeVisible()
    // No customer name may appear in a refusal.
    await expect(conversation.getByText(/Ayala/)).toHaveCount(0)
  })

  test('answers an overdue query without changing anything', async ({ page }) => {
    await page.getByLabel('Message', { exact: true }).fill('What is overdue?')
    await page.getByRole('button', { name: 'Send message' }).click()

    await expect(page.getByTestId('whatsapp-conversation').getByText(/OVERDUE/)).toBeVisible()
  })

  test('answers a no-next-action query', async ({ page }) => {
    await page.getByLabel('Message', { exact: true }).fill('Who has no next action?')
    await page.getByRole('button', { name: 'Send message' }).click()

    const conversation = page.getByTestId('whatsapp-conversation')
    await expect(conversation.getByText(/NO NEXT ACTION/)).toBeVisible()
    await expect(conversation.getByText(/Renata Okonkwo/)).toBeVisible()
  })

  test('shows delivery diagnostics including a permanent failure', async ({ page }) => {
    const diagnostics = section(page, 'Delivery diagnostics')

    await expect(diagnostics.getByText('permanent', { exact: true })).toBeVisible()
    await expect(diagnostics.getByText(/Overdue: Priya Raghunathan/)).toBeVisible()
  })

  test('reports measured usage and a cost projection', async ({ page }) => {
    await expect(page.getByText('Messages Sent')).toBeVisible()
    await expect(page.getByText('Projected Yearly')).toBeVisible()
  })
})

test.describe('Phase 3 settings', () => {
  test('exposes reminder, digest and intake controls', async ({ page }) => {
    await page.goto('/settings')

    await expect(page.getByRole('heading', { name: 'Screenshot intake' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Reminders and digests' })).toBeVisible()

    await page.getByLabel('Digest-only mode', { exact: true }).selectOption('on')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved' })).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Digest-only mode', { exact: true })).toHaveValue('on')
  })
})
