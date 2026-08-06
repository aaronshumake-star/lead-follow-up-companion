/**
 * WhatsApp Business Platform Cloud API.
 *
 * Server-only. Every value it needs is a secret, so this is imported by the
 * Cloudflare Worker and never by browser code — nothing here is prefixed VITE_
 * and nothing here reads import.meta.env.
 *
 * Two rules are enforced here rather than left to the caller, because they are
 * the difference between a personal reminder tool and an accidental bulk
 * messaging system:
 *
 *   1. The destination is checked against the approved number on every send.
 *      A bug elsewhere cannot cause a message to a customer.
 *   2. Webhook payloads are rejected unless the X-Hub-Signature-256 header
 *      verifies against the app secret.
 */

import type { ProviderInfo, ProviderResult } from '../types.ts'
import { providerFailure, providerOk } from '../types.ts'
import type {
  InboundWhatsAppMessage,
  OutboundWhatsAppMessage,
  SendResult,
  WhatsAppProvider,
} from './types.ts'
import { isApprovedSender } from './types.ts'

export interface CloudApiConfig {
  accessToken: string
  phoneNumberId: string
  businessAccountId?: string
  approvedNumberE164: string
  appSecret: string
  webhookVerifyToken: string
  apiVersion: string
  /** Injected in tests so no real request is ever made. */
  fetchImpl?: typeof fetch
}

/** Delivery and read receipts, plus failures, arrive on the same webhook. */
export interface WhatsAppStatusEvent {
  providerMessageId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  errorTitle?: string
  /** False for a permanent rejection, so retries stop. */
  retryable?: boolean
}

export interface WebhookParseResult {
  messages: InboundWhatsAppMessage[]
  statuses: WhatsAppStatusEvent[]
}

export interface CloudApiProvider extends WhatsAppProvider {
  /** Answers Meta's GET verification handshake. */
  verifyWebhookChallenge(params: URLSearchParams): string | null
  /** Constant-time signature check over the raw body. */
  verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean>
  parseWebhookEnvelope(payload: unknown): WebhookParseResult
  markAsRead(providerMessageId: string): Promise<void>
}

export function createCloudApiProvider(config: CloudApiConfig): CloudApiProvider {
  const doFetch = config.fetchImpl ?? fetch
  const base = `https://graph.facebook.com/${config.apiVersion}`

  return {
    info: {
      id: 'whatsapp_cloud',
      displayName: 'WhatsApp Cloud API',
      isConfigured: true,
      isBillable: true,
    } satisfies ProviderInfo,

    async send(message: OutboundWhatsAppMessage): Promise<ProviderResult<SendResult>> {
      // The structural guard: only ever the approved number.
      if (!isApprovedSender(message.toE164, config.approvedNumberE164)) {
        return providerFailure<SendResult>(
          'unauthorized_sender',
          'Refused: the destination is not the approved number.',
        )
      }

      const body =
        message.templateName === undefined
          ? {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: message.toE164,
              type: 'text',
              text: { preview_url: false, body: message.body },
            }
          : {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: message.toE164,
              type: 'template',
              template: {
                name: message.templateName,
                language: { code: 'en_US' },
                components:
                  message.templateVariables === undefined
                    ? []
                    : [
                        {
                          type: 'body',
                          parameters: message.templateVariables.map((text) => ({ type: 'text', text })),
                        },
                      ],
              },
            }

      try {
        const response = await doFetch(`${base}/${config.phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          // 4xx is the provider telling us the request is wrong; retrying it
          // would bill for the same rejection again. 5xx is worth another go.
          const retryable = response.status >= 500 || response.status === 429
          return providerFailure<SendResult>(
            retryable ? 'provider_error' : 'invalid_input',
            `WhatsApp rejected the message (HTTP ${response.status}).`,
            retryable,
          )
        }

        const payload = (await response.json()) as {
          messages?: Array<{ id?: string }>
        }
        const providerMessageId = payload.messages?.[0]?.id

        if (typeof providerMessageId !== 'string') {
          return providerFailure<SendResult>(
            'provider_error',
            'WhatsApp accepted the message but returned no message id.',
            true,
          )
        }

        return providerOk<SendResult>({
          providerId: 'whatsapp_cloud',
          providerMessageId,
          // Business-initiated messages open a billable conversation.
          billable: message.templateName !== undefined,
          sentAt: new Date().toISOString(),
        })
      } catch {
        return providerFailure<SendResult>('timeout', 'Could not reach WhatsApp.', true)
      }
    },

    parseWebhook(payload: unknown, signature: string | null): ProviderResult<InboundWhatsAppMessage[]> {
      // The synchronous interface cannot await the signature check, so it
      // refuses rather than parsing optimistically. The worker calls
      // verifySignature and parseWebhookEnvelope instead.
      if (signature === null) {
        return providerFailure<InboundWhatsAppMessage[]>(
          'unauthorized_sender',
          'Unsigned webhook payloads are rejected.',
        )
      }

      return providerOk(parseEnvelope(payload).messages)
    },

    verifyWebhookChallenge(params: URLSearchParams): string | null {
      const mode = params.get('hub.mode')
      const token = params.get('hub.verify_token')
      const challenge = params.get('hub.challenge')

      if (mode !== 'subscribe') return null
      if (token === null || !timingSafeEqual(token, config.webhookVerifyToken)) return null

      return challenge
    },

    async verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
      if (signatureHeader === null || !signatureHeader.startsWith('sha256=')) return false

      const expected = await hmacSha256Hex(config.appSecret, rawBody)
      return timingSafeEqual(signatureHeader.slice('sha256='.length), expected)
    },

    parseWebhookEnvelope(payload: unknown): WebhookParseResult {
      return parseEnvelope(payload)
    },

    async markAsRead(providerMessageId: string): Promise<void> {
      try {
        await doFetch(`${base}/${config.phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: providerMessageId,
          }),
        })
      } catch {
        // Read receipts are cosmetic; failing to send one must never fail the
        // webhook, because Meta would then retry the whole delivery.
      }
    },

    async fetchMedia(mediaId: string): Promise<ProviderResult<Blob>> {
      if (!/^[A-Za-z0-9._-]{5,200}$/.test(mediaId)) {
        return providerFailure('invalid_input', 'Invalid media id.')
      }
      try {
        const metadata = await doFetch(`${base}/${mediaId}`, {
          headers: { authorization: `Bearer ${config.accessToken}` },
        })
        if (!metadata.ok) {
          return providerFailure(
            'provider_error',
            `Media metadata failed (HTTP ${metadata.status}).`,
            metadata.status === 429 || metadata.status >= 500,
          )
        }
        const value = (await metadata.json()) as { url?: string; mime_type?: string; file_size?: number }
        if (typeof value.url !== 'string') {
          return providerFailure('provider_error', 'Meta returned no media URL.')
        }
        const response = await doFetch(value.url, {
          headers: { authorization: `Bearer ${config.accessToken}` },
        })
        if (!response.ok) {
          return providerFailure(
            'provider_error',
            `Media download failed (HTTP ${response.status}).`,
            response.status === 429 || response.status >= 500,
          )
        }
        const blob = await response.blob()
        if (typeof value.file_size === 'number' && blob.size !== value.file_size) {
          return providerFailure('invalid_input', 'Downloaded media size did not match metadata.')
        }
        return providerOk(blob)
      } catch {
        return providerFailure('timeout', 'Could not download the voice message.', true)
      }
    },
  }
}

/**
 * Cloud API error codes worth another attempt.
 *
 * Everything else — an undeliverable number, a re-engagement rejection, an
 * account problem — will fail identically on a retry, so those are recorded as
 * permanent and surfaced in diagnostics instead of being sent again.
 */
const RETRYABLE_PROVIDER_CODES = new Set([
  130429, // rate limit hit
  131000, // generic temporary failure
  131056, // pair rate limit hit
  133016, // account temporarily unavailable
])

/**
 * Extracts messages and status events from a Cloud API envelope.
 *
 * Defensive throughout: the payload is untrusted until the signature has been
 * checked, and even then a malformed entry must not throw, because an
 * exception here would make Meta retry the delivery indefinitely.
 */
function parseEnvelope(payload: unknown): WebhookParseResult {
  const messages: InboundWhatsAppMessage[] = []
  const statuses: WhatsAppStatusEvent[] = []

  const entries = asArray(asRecord(payload)?.['entry'])

  for (const entry of entries) {
    for (const change of asArray(asRecord(entry)?.['changes'])) {
      const value = asRecord(asRecord(change)?.['value'])
      if (value === null) continue

      for (const raw of asArray(value['messages'])) {
        const message = asRecord(raw)
        if (message === null) continue

        const id = asString(message['id'])
        const from = asString(message['from'])
        if (id === null || from === null) continue

        const timestamp = asString(message['timestamp'])
        const text = asRecord(message['text'])
        const audio = asRecord(message['audio'])

        messages.push({
          providerMessageId: id,
          // The Cloud API omits the leading plus; restore it so the approved
          // number comparison is an exact E.164 match.
          fromE164: from.startsWith('+') ? from : `+${from}`,
          receivedAt: toIso(timestamp),
          text: asString(text?.['body']) ?? undefined,
          audio:
            audio === null
              ? undefined
              : {
                  mediaId: asString(audio['id']) ?? '',
                  mimeType: asString(audio['mime_type']) ?? 'audio/ogg',
                },
        })
      }

      for (const raw of asArray(value['statuses'])) {
        const status = asRecord(raw)
        if (status === null) continue

        const id = asString(status['id'])
        const state = asString(status['status'])
        if (id === null || state === null) continue

        const errors = asArray(status['errors'])
        const firstError = asRecord(errors[0])
        const code = typeof firstError?.['code'] === 'number' ? (firstError['code'] as number) : null

        statuses.push({
          providerMessageId: id,
          status: state === 'failed' ? 'failed' : (state as WhatsAppStatusEvent['status']),
          timestamp: toIso(asString(status['timestamp'])),
          errorTitle: asString(firstError?.['title']) ?? undefined,
          // Allow-list rather than a range: Meta's codes are not HTTP statuses,
          // and defaulting to "retry" would spend billable attempts on
          // rejections that will never succeed.
          retryable: code !== null && RETRYABLE_PROVIDER_CODES.has(code),
        })
      }
    }
  }

  return { messages, statuses }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function toIso(timestamp: string | null): string {
  if (timestamp === null) return new Date().toISOString()

  const seconds = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(seconds)) return new Date().toISOString()

  return new Date(seconds * 1000).toISOString()
}

/** HMAC-SHA256 as lowercase hex, using WebCrypto so it works in a Worker. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))

  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Length-independent comparison.
 *
 * A plain === on a signature leaks how many leading characters matched through
 * timing, which is enough to forge one given patience.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }

  return mismatch === 0
}
