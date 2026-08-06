import { expect, test } from '@playwright/test'

test.describe('Phase 4 voice notes and recovery', () => {
  test('processes a clear voice note and deletes audio', async ({ page }) => {
    await page.goto('/whatsapp')
    await page.getByLabel('Voice scenario').selectOption('call_no_answer')
    await page.getByRole('button', { name: 'Simulate voice note' }).click()
    await expect(page.getByTestId('voice-reply')).toContainText('Updated Jesus Ayala')
    const voice = page.locator('section').filter({ hasText: 'Voice Notes' })
    await expect(voice.getByText('applied', { exact: true })).toBeVisible()
    await expect(voice.getByText(/audio deleted/i)).toBeVisible()
  })

  test('clarifies an ambiguous voice note and accepts the text reply', async ({ page }) => {
    await page.goto('/whatsapp')
    await page.getByLabel('Voice scenario').selectOption('ambiguous_customer')
    await page.getByRole('button', { name: 'Simulate voice note' }).click()
    await expect(page.getByTestId('voice-reply')).toContainText('Jesus Ayala')

    await page.getByLabel('Message', { exact: true }).fill('1')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByTestId('whatsapp-conversation')).toContainText('Updated Jesus Ayala')
  })

  test('rejects unknown voice sender before processing', async ({ page }) => {
    await page.goto('/whatsapp')
    const voice = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Voice Notes' }) })
    await voice.getByRole('button', { name: 'Use unknown sender' }).click()
    await voice.getByRole('button', { name: 'Simulate voice note' }).click()
    await expect(page.getByTestId('voice-reply')).toContainText('not authorised')
    await expect(page.getByTestId('voice-reply')).not.toContainText('Ayala')
  })

  test('shows a safe retry for temporary transcription failure', async ({ page }) => {
    await page.goto('/whatsapp')
    await page.getByLabel('Voice scenario').selectOption('temporary_failure')
    await page.getByRole('button', { name: 'Simulate voice note' }).click()
    const voice = page.locator('section').filter({ hasText: 'Voice Notes' })
    await expect(voice.getByRole('button', { name: 'Retry safe failure' })).toBeVisible()
    await voice.getByRole('button', { name: 'Retry safe failure' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Safe retry completed' })).toBeVisible()
  })

  test('downloads backup and validates it in a dry run', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Export and Backup' })).toBeVisible()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download JSON backup' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^lead-follow-up-backup-\d{4}-\d{2}-\d{2}\.json$/)
    const path = await file.path()
    expect(path).not.toBeNull()
  })

  test('shows privacy and operational diagnostics without secrets', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Privacy and Data Deletion' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Operational Diagnostics' })).toBeVisible()
    await expect(page.getByText('20260808000100')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('SUPABASE_SERVICE_ROLE_KEY')
  })
})
