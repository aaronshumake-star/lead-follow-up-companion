import { z } from 'zod'

/**
 * Client-visible configuration.
 *
 * Everything here ships to the browser, so only publishable values belong in
 * this file. The Supabase service-role key, WhatsApp tokens and transcription
 * keys are server-only and are never read through import.meta.env.
 */
const clientEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url().optional(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  VITE_APP_NAME: z.string().min(1).default('Lead Follow-Up Companion'),
  VITE_DEFAULT_TIME_ZONE: z.string().min(1).default('America/Chicago'),
  /**
   * Lets the app run — and the test suite and Playwright smoke test run —
   * against fictional fixtures with no Supabase project attached.
   */
  VITE_DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>

function readEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse(import.meta.env)

  if (!parsed.success) {
    // Field names only. Values could contain credentials and must not be logged.
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new Error(`Invalid client environment configuration. Check: ${fields}`)
  }

  return parsed.data
}

export const env = readEnv()

/** True once both Supabase publishable values are present. */
export const isSupabaseConfigured =
  typeof env.VITE_SUPABASE_URL === 'string' && typeof env.VITE_SUPABASE_ANON_KEY === 'string'

/**
 * Demo mode is on when explicitly requested, and also whenever Supabase is not
 * configured — a fresh clone should start and be explorable before anyone
 * creates a project.
 */
export const isDemoMode = env.VITE_DEMO_MODE || !isSupabaseConfigured
