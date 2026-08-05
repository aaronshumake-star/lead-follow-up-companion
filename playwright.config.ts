import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end smoke tests.
 *
 * They run against the demo-mode build, so no Supabase project, credentials or
 * network access are required. Chromium only: the app is used in one browser on
 * one machine, and a browser matrix would cost CI minutes for no benefit.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_DEMO_MODE: 'true' },
  },
})
