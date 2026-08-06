/**
 * Cloudflare Worker: the scheduled reminder run and the WhatsApp webhook.
 *
 * Thin glue. Every decision lives in src/server and src/domain, which is why
 * both handlers here are short and why the rules are testable without deploying
 * anything.
 *
 * Cost note: this runs on the Workers free tier. The cron fires every fifteen
 * minutes, which is roughly 2,900 invocations a month against a 100,000/day
 * allowance.
 */

import { readWorkerEnv } from './env.ts'
import { createSupabaseStore } from './supabase-store.ts'
import { createCloudApiProvider } from '../src/providers/whatsapp/cloud-api.ts'
import { dispatchReminders } from '../src/server/reminder-dispatcher.ts'
import { handleInboundText, handleStatusEvent } from '../src/server/webhook-router.ts'
import type { MessagingPort } from '../src/server/ports.ts'

export interface Env extends Record<string, unknown> {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  WHATSAPP_ACCESS_TOKEN: string
  WHATSAPP_PHONE_NUMBER_ID: string
  WHATSAPP_APPROVED_NUMBER: string
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: string
  WHATSAPP_APP_SECRET: string
  WHATSAPP_API_VERSION: string
}

export default {
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/healthz') {
      return new Response('ok', { status: 200 })
    }

    const config = readWorkerEnv(rawEnv)
    if (!config.ok) {
      // Names only — never values.
      return json({ error: config.message }, 503)
    }

    const provider = createCloudApiProvider({
      accessToken: config.env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: config.env.WHATSAPP_PHONE_NUMBER_ID,
      approvedNumberE164: config.env.WHATSAPP_APPROVED_NUMBER,
      appSecret: config.env.WHATSAPP_APP_SECRET,
      webhookVerifyToken: config.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      apiVersion: config.env.WHATSAPP_API_VERSION,
    })

    if (url.pathname === '/webhooks/whatsapp') {
      // Meta's verification handshake.
      if (request.method === 'GET') {
        const challenge = provider.verifyWebhookChallenge(url.searchParams)
        return challenge === null
          ? new Response('forbidden', { status: 403 })
          : new Response(challenge, { status: 200 })
      }

      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

      const rawBody = await request.text()
      const signature = request.headers.get('x-hub-signature-256')

      // Untrusted until this passes. A failed signature is refused without
      // being parsed at all.
      if (!(await provider.verifySignature(rawBody, signature))) {
        return new Response('invalid signature', { status: 401 })
      }

      let payload: unknown
      try {
        payload = JSON.parse(rawBody)
      } catch {
        // Acknowledged so Meta stops retrying a payload we can never parse.
        return json({ received: true, ignored: 'unparseable' }, 200)
      }

      const store = createSupabaseStore(config.env.SUPABASE_URL, config.env.SUPABASE_SERVICE_ROLE_KEY)
      const messaging = toMessagingPort(provider)
      const envelope = provider.parseWebhookEnvelope(payload)

      const accounts = await store.listAccounts()
      const account =
        accounts.find((candidate) => candidate.approvedNumberE164 === config.env.WHATSAPP_APPROVED_NUMBER) ??
        accounts[0]

      if (account === undefined) return json({ received: true, ignored: 'no account' }, 200)

      for (const status of envelope.statuses) {
        await handleStatusEvent(store, status)
      }

      for (const message of envelope.messages) {
        if (message.text === undefined) continue

        await handleInboundText(
          store,
          messaging,
          { ...account, approvedNumberE164: config.env.WHATSAPP_APPROVED_NUMBER },
          {
            providerMessageId: message.providerMessageId,
            fromE164: message.fromE164,
            text: message.text,
            receivedAt: message.receivedAt,
          },
        )
      }

      // Always 200 once the signature is valid: a non-2xx makes Meta redeliver,
      // and a redelivery of an already-applied command is exactly what the
      // duplicate check exists to prevent.
      return json({ received: true }, 200)
    }

    if (url.pathname === '/tasks/reminders' && request.method === 'POST') {
      const token = request.headers.get('authorization')
      const expected = config.env.SCHEDULER_TRIGGER_TOKEN

      // The manual trigger only exists when a token is configured, so it cannot
      // be left open by accident.
      if (expected === undefined || token !== `Bearer ${expected}`) {
        return new Response('unauthorized', { status: 401 })
      }

      const summary = await runReminders(config.env, provider)
      return json(summary, 200)
    }

    return new Response('not found', { status: 404 })
  },

  async scheduled(_event: ScheduledEvent, rawEnv: Env): Promise<void> {
    const config = readWorkerEnv(rawEnv)
    if (!config.ok) {
      // Logged without values so a misconfiguration is visible in the tail.
      console.error(config.message)
      return
    }

    const provider = createCloudApiProvider({
      accessToken: config.env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: config.env.WHATSAPP_PHONE_NUMBER_ID,
      approvedNumberE164: config.env.WHATSAPP_APPROVED_NUMBER,
      appSecret: config.env.WHATSAPP_APP_SECRET,
      webhookVerifyToken: config.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      apiVersion: config.env.WHATSAPP_API_VERSION,
    })

    const summary = await runReminders(config.env, provider)
    console.warn(`reminder run: ${JSON.stringify(summary)}`)
  },
}

async function runReminders(
  env: import('./env.ts').WorkerEnv,
  provider: ReturnType<typeof createCloudApiProvider>,
) {
  const store = createSupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

  return dispatchReminders(store, toMessagingPort(provider), { claimedBy: 'worker' })
}

/** Adapts the provider interface to the narrow port the dispatcher needs. */
function toMessagingPort(provider: ReturnType<typeof createCloudApiProvider>): MessagingPort {
  return {
    async sendText(input) {
      const result = await provider.send({
        toE164: input.toE164,
        kind: 'follow_up_reminder',
        idempotencyKey: input.idempotencyKey,
        body: input.body,
      })

      if (result.ok) {
        return {
          status: 'sent',
          providerMessageId: result.value.providerMessageId,
          billable: result.value.billable,
        }
      }

      return {
        status: 'failed',
        error: result.error.message,
        // Only a retryable provider error gets another attempt.
        permanent: !result.error.retryable,
      }
    },
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
