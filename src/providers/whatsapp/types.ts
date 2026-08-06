/**
 * WhatsApp messaging.
 *
 * WhatsApp is a core feature, not a convenience: reminders, digests, replies and
 * voice-note commands all run through it. The interface exists so the transport
 * (WhatsApp Business Platform Cloud API today) can be replaced without touching
 * feature code, and so cost controls live in one place.
 *
 * Two rules are structural rather than optional:
 *
 *   1. Only the approved number is ever messaged, and only the approved number
 *      may send commands. `isApprovedSender` below is the single check.
 *   2. Every send carries an idempotency key. The notification_log has a unique
 *      index on it, so a retry cannot bill twice.
 */

import type { ProviderInfo, ProviderResult } from '../types.ts'
import type { NotificationKind } from '../../domain/vocabulary.ts'
import { isE164 } from '../../lib/normalize.ts'

export interface OutboundWhatsAppMessage {
  /** Must equal the approved number; the provider re-checks before sending. */
  toE164: string
  kind: NotificationKind
  /**
   * Deterministic per logical message, e.g.
   * `follow_up_reminder:<followUpId>:2026-08-05`. Retrying with the same key
   * must never produce a second billable message.
   */
  idempotencyKey: string
  body: string
  /** Required by the Cloud API outside a 24-hour customer service window. */
  templateName?: string
  templateVariables?: readonly string[]
}

export interface SendResult {
  providerId: string
  providerMessageId: string
  /** False for replies inside a free service window; drives the cost meter. */
  billable: boolean
  sentAt: string
}

export interface InboundWhatsAppMessage {
  providerMessageId: string
  fromE164: string
  receivedAt: string
  /** Present for text messages. Untrusted. */
  text?: string
  /** Present for voice notes; handed to the transcription provider. */
  audio?: { mediaId: string; mimeType: string; durationSeconds?: number }
}

/**
 * The messaging transport.
 *
 * `send` is the text send the brief calls sendText; `verifyWebhook` and
 * `markAsRead` are optional because not every provider supports them, and a
 * transport that cannot verify a signature must still be usable for outbound
 * reminders rather than blocking the feature entirely.
 */
export interface WhatsAppProvider {
  readonly info: ProviderInfo
  send(message: OutboundWhatsAppMessage): Promise<ProviderResult<SendResult>>
  /**
   * Verifies the webhook signature and returns the messages it contains.
   * Payloads are untrusted until this succeeds.
   */
  parseWebhook(payload: unknown, signature: string | null): ProviderResult<InboundWhatsAppMessage[]>
  /** Downloads voice-note audio for transcription. Arrives with Phase 4. */
  fetchMedia(mediaId: string): Promise<ProviderResult<Blob>>
  /** Confirms a raw request body against the provider's signature scheme. */
  verifyWebhook?(rawBody: string, signatureHeader: string | null): Promise<boolean>
  markAsRead?(providerMessageId: string): Promise<void>
}

/**
 * The authorization check for every inbound command.
 *
 * Exact E.164 comparison, no normalisation of the incoming value beyond
 * trimming: a number that does not already arrive in canonical form from the
 * provider is not one we should be trusting. Returns false when no approved
 * number is configured, so the system fails closed.
 */
export function isApprovedSender(
  fromE164: string | null | undefined,
  approvedE164: string | null | undefined,
): boolean {
  if (!isE164(approvedE164)) return false
  if (typeof fromE164 !== 'string') return false

  return fromE164.trim() === approvedE164?.trim()
}

/**
 * Builds the idempotency key for a send. Including the local date means a daily
 * digest can be re-attempted after a failure but cannot be sent twice in a day.
 */
export function buildIdempotencyKey(
  kind: NotificationKind,
  subjectId: string,
  localDate: string,
): string {
  return `${kind}:${subjectId}:${localDate}`
}
