import { describe, expect, it, vi } from 'vitest'
import { createCloudApiProvider, hmacSha256Hex, timingSafeEqual } from './cloud-api.ts'
import { createSimulatedWhatsAppProvider } from './simulated.ts'

const APPROVED = '+15550100999'
const APP_SECRET = 'test-app-secret-value'
const VERIFY_TOKEN = 'test-verify-token'

function provider(fetchImpl?: typeof fetch) {
  return createCloudApiProvider({
    accessToken: 'test-access-token-value',
    phoneNumberId: '123456789',
    approvedNumberE164: APPROVED,
    appSecret: APP_SECRET,
    webhookVerifyToken: VERIFY_TOKEN,
    apiVersion: 'v21.0',
    fetchImpl,
  })
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('webhook verification', () => {
  it('answers the challenge when the verify token matches', () => {
    const params = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': '1234567',
    })

    expect(provider().verifyWebhookChallenge(params)).toBe('1234567')
  })

  it('refuses a wrong verify token', () => {
    const params = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': '1234567',
    })

    expect(provider().verifyWebhookChallenge(params)).toBeNull()
  })

  it('refuses a mode other than subscribe', () => {
    const params = new URLSearchParams({
      'hub.mode': 'unsubscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': '1234567',
    })

    expect(provider().verifyWebhookChallenge(params)).toBeNull()
  })
})

describe('signature validation', () => {
  it('accepts a correctly signed body', async () => {
    const body = JSON.stringify({ entry: [] })
    const signature = `sha256=${await hmacSha256Hex(APP_SECRET, body)}`

    expect(await provider().verifySignature(body, signature)).toBe(true)
  })

  it('rejects a tampered body', async () => {
    const body = JSON.stringify({ entry: [] })
    const signature = `sha256=${await hmacSha256Hex(APP_SECRET, body)}`

    expect(await provider().verifySignature(`${body} `, signature)).toBe(false)
  })

  it('rejects a signature made with the wrong secret', async () => {
    const body = JSON.stringify({ entry: [] })
    const signature = `sha256=${await hmacSha256Hex('not-the-secret', body)}`

    expect(await provider().verifySignature(body, signature)).toBe(false)
  })

  it('rejects a missing or malformed signature header', async () => {
    expect(await provider().verifySignature('{}', null)).toBe(false)
    expect(await provider().verifySignature('{}', 'nonsense')).toBe(false)
  })
})

describe('timingSafeEqual', () => {
  it('matches identical strings and rejects everything else', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    // Different lengths must not throw or short-circuit into a match.
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('webhook parsing', () => {
  it('extracts a text message and restores the leading plus', () => {
    const result = provider().parseWebhookEnvelope({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.1',
                    // The Cloud API omits the plus; the approved-number check
                    // is an exact E.164 comparison, so it has to come back.
                    from: '15550100999',
                    timestamp: '1785000000',
                    text: { body: 'Called Jesus Ayala, no answer.' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.fromE164).toBe('+15550100999')
    expect(result.messages[0]?.text).toBe('Called Jesus Ayala, no answer.')
  })

  it('extracts delivery, read and failure events', () => {
    const result = provider().parseWebhookEnvelope({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.a', status: 'delivered', timestamp: '1785000000' },
                  { id: 'wamid.b', status: 'read', timestamp: '1785000001' },
                  {
                    id: 'wamid.c',
                    status: 'failed',
                    timestamp: '1785000002',
                    errors: [{ code: 131047, title: 'Re-engagement message' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(result.statuses.map((status) => status.status)).toEqual(['delivered', 'read', 'failed'])
    expect(result.statuses[2]?.errorTitle).toBe('Re-engagement message')
    // 131047 will fail identically on a retry, so it must not be retried.
    expect(result.statuses[2]?.retryable).toBe(false)
  })

  it('treats a rate-limit error code as retryable', () => {
    const result = provider().parseWebhookEnvelope({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.d',
                    status: 'failed',
                    timestamp: '1785000003',
                    errors: [{ code: 130429, title: 'Rate limit hit' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(result.statuses[0]?.retryable).toBe(true)
  })

  it('returns nothing rather than throwing on a malformed envelope', () => {
    // An exception here would make Meta retry the delivery indefinitely.
    expect(provider().parseWebhookEnvelope(null)).toEqual({ messages: [], statuses: [] })
    expect(provider().parseWebhookEnvelope({ entry: 'nonsense' })).toEqual({ messages: [], statuses: [] })
    expect(provider().parseWebhookEnvelope({ entry: [{ changes: [{}] }] })).toEqual({
      messages: [],
      statuses: [],
    })
  })

  it('refuses to parse an unsigned payload through the shared interface', () => {
    const result = provider().parseWebhook({ entry: [] }, null)

    expect(result.ok).toBe(false)
  })
})

describe('sending', () => {
  it('refuses any destination that is not the approved number', async () => {
    const fetchImpl = vi.fn()
    const result = await provider(fetchImpl as unknown as typeof fetch).send({
      toE164: '+15550100777',
      kind: 'follow_up_reminder',
      idempotencyKey: 'k',
      body: 'hello',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('unauthorized_sender')
    // The guard runs before the request, so nothing was attempted.
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns the provider message id on success', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ messages: [{ id: 'wamid.out.1' }] }))

    const result = await provider(fetchImpl as unknown as typeof fetch).send({
      toE164: APPROVED,
      kind: 'follow_up_reminder',
      idempotencyKey: 'k',
      body: 'hello',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.providerMessageId).toBe('wamid.out.1')
  })

  it('treats a 4xx as permanent and a 5xx as retryable', async () => {
    const badRequest = vi.fn(async () => new Response('bad', { status: 400 }))
    const serverError = vi.fn(async () => new Response('oops', { status: 503 }))

    const permanent = await provider(badRequest as unknown as typeof fetch).send({
      toE164: APPROVED,
      kind: 'follow_up_reminder',
      idempotencyKey: 'k',
      body: 'hello',
    })
    const transient = await provider(serverError as unknown as typeof fetch).send({
      toE164: APPROVED,
      kind: 'follow_up_reminder',
      idempotencyKey: 'k',
      body: 'hello',
    })

    expect(permanent.ok).toBe(false)
    if (!permanent.ok) expect(permanent.error.retryable).toBe(false)

    expect(transient.ok).toBe(false)
    if (!transient.ok) expect(transient.error.retryable).toBe(true)
  })

  it('treats a rate limit as retryable', async () => {
    const limited = vi.fn(async () => new Response('slow down', { status: 429 }))

    const result = await provider(limited as unknown as typeof fetch).send({
      toE164: APPROVED,
      kind: 'follow_up_reminder',
      idempotencyKey: 'k',
      body: 'hello',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.retryable).toBe(true)
  })

  it('never leaks the provider body into the error message', async () => {
    const failing = vi.fn(async () => new Response('token abc123 leaked', { status: 400 }))

    const result = await provider(failing as unknown as typeof fetch).send({
      toE164: APPROVED,
      kind: 'follow_up_reminder',
      idempotencyKey: 'k',
      body: 'hello',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).not.toContain('abc123')
  })
})

describe('simulated provider', () => {
  it('applies the same destination guard as the real one', async () => {
    const simulated = createSimulatedWhatsAppProvider(APPROVED)

    const result = await simulated.send({
      toE164: '+15550100777',
      kind: 'follow_up_reminder',
      idempotencyKey: 'k',
      body: 'hello',
    })

    expect(result.ok).toBe(false)
    expect(simulated.outbox).toHaveLength(0)
  })

  it('records what would have been sent', async () => {
    const simulated = createSimulatedWhatsAppProvider(APPROVED)

    await simulated.send({
      toE164: APPROVED,
      kind: 'follow_up_reminder',
      idempotencyKey: 'k',
      body: 'FOLLOW-UP DUE',
    })

    expect(simulated.outbox).toHaveLength(1)
    expect(simulated.outbox[0]?.body).toBe('FOLLOW-UP DUE')
  })

  it('can be made to fail so retry behaviour is testable', async () => {
    const simulated = createSimulatedWhatsAppProvider(APPROVED)
    simulated.failNextSend({ retryable: true })

    const failed = await simulated.send({
      toE164: APPROVED,
      kind: 'follow_up_reminder',
      idempotencyKey: 'k',
      body: 'x',
    })
    const recovered = await simulated.send({
      toE164: APPROVED,
      kind: 'follow_up_reminder',
      idempotencyKey: 'k',
      body: 'x',
    })

    expect(failed.ok).toBe(false)
    expect(recovered.ok).toBe(true)
  })

  it('still fails closed on an unsigned webhook', async () => {
    const simulated = createSimulatedWhatsAppProvider(APPROVED)

    expect(simulated.parseWebhook([], null).ok).toBe(false)
    expect(await simulated.verifyWebhook?.('{}', null)).toBe(false)
  })
})
