/**
 * Server-only configuration.
 *
 * Every value here is a secret. None of them is prefixed VITE_, none is read
 * from import.meta.env, and this module is only ever imported by the Worker —
 * so nothing here can reach the browser bundle.
 *
 * The service-role key in particular bypasses Row Level Security entirely. It
 * lives as a Worker secret and is used only by the scheduler and the webhook,
 * both of which scope every query to an explicit user id.
 */

import { z } from 'zod'

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'must be an E.164 number')

export const workerEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  /** Bypasses RLS. Worker secret only, never in client code. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  WHATSAPP_ACCESS_TOKEN: z.string().min(20),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(5),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(5).optional(),
  /** The only number that may be messaged, or may send commands. */
  WHATSAPP_APPROVED_NUMBER: e164,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(10),
  /** Validates X-Hub-Signature-256 on every webhook delivery. */
  WHATSAPP_APP_SECRET: z.string().min(10),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v21.0'),

  /** Shared secret for the manual scheduler trigger, if it is exposed. */
  SCHEDULER_TRIGGER_TOKEN: z.string().min(16).optional(),
})

export type WorkerEnv = z.infer<typeof workerEnvSchema>

export type EnvValidation =
  | { ok: true; env: WorkerEnv }
  | { ok: false; missing: string[]; message: string }

/**
 * Validates configuration at request time.
 *
 * Returns a result rather than throwing: a misconfigured Worker should answer
 * with a clear 503 that names the missing variables, not crash in a way that
 * makes Meta retry the delivery forever. Only variable *names* appear in the
 * message — never values.
 */
export function readWorkerEnv(raw: unknown): EnvValidation {
  const parsed = workerEnvSchema.safeParse(raw)

  if (parsed.success) return { ok: true, env: parsed.data }

  const missing = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))]

  return {
    ok: false,
    missing,
    message: `WhatsApp is not configured. Missing or invalid: ${missing.join(', ')}`,
  }
}
