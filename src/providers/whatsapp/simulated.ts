/**
 * Simulated WhatsApp transport for demo mode and automated tests.
 *
 * Records what would have been sent instead of sending it, so the entire
 * reminder and command workflow is exercisable with no credentials, no network
 * and no cost. Every message it captures is labelled as simulated wherever it
 * is displayed, so a demo conversation can never be mistaken for a real one.
 *
 * It deliberately keeps the same guards as the real provider — the destination
 * check and the signature refusal — so a mistake caught here would have been
 * caught in production too.
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

export interface SimulatedMessage {
  toE164: string
  body: string
  idempotencyKey: string
  providerMessageId: string
  sentAt: string
}

export interface SimulatedWhatsAppProvider extends WhatsAppProvider {
  /** Everything "sent" so far, newest last. */
  readonly outbox: readonly SimulatedMessage[]
  /** Forces the next send to fail, so retry behaviour is testable. */
  failNextSend(options?: { retryable?: boolean; message?: string }): void
  clear(): void
}

export function createSimulatedWhatsAppProvider(
  approvedNumberE164: string,
): SimulatedWhatsAppProvider {
  const outbox: SimulatedMessage[] = []
  let counter = 0
  let pendingFailure: { retryable: boolean; message: string } | null = null

  return {
    info: {
      id: 'simulated',
      displayName: 'Simulated WhatsApp (demo)',
      isConfigured: true,
      // Nothing is sent, so nothing can be billed.
      isBillable: false,
    } satisfies ProviderInfo,

    get outbox() {
      return outbox
    },

    failNextSend(options = {}) {
      pendingFailure = {
        retryable: options.retryable ?? true,
        message: options.message ?? 'Simulated provider failure',
      }
    },

    clear() {
      outbox.length = 0
      counter = 0
      pendingFailure = null
    },

    async send(message: OutboundWhatsAppMessage): Promise<ProviderResult<SendResult>> {
      // The same structural guard the real provider applies.
      if (!isApprovedSender(message.toE164, approvedNumberE164)) {
        return providerFailure<SendResult>(
          'unauthorized_sender',
          'Refused: the destination is not the approved number.',
        )
      }

      if (pendingFailure !== null) {
        const failure = pendingFailure
        pendingFailure = null
        return providerFailure<SendResult>(
          failure.retryable ? 'provider_error' : 'invalid_input',
          failure.message,
          failure.retryable,
        )
      }

      counter += 1
      const sent: SimulatedMessage = {
        toE164: message.toE164,
        body: message.body,
        idempotencyKey: message.idempotencyKey,
        providerMessageId: `sim-${counter.toString().padStart(4, '0')}`,
        sentAt: new Date().toISOString(),
      }

      outbox.push(sent)

      return providerOk<SendResult>({
        providerId: 'simulated',
        providerMessageId: sent.providerMessageId,
        billable: false,
        sentAt: sent.sentAt,
      })
    },

    parseWebhook(payload: unknown, signature: string | null): ProviderResult<InboundWhatsAppMessage[]> {
      if (signature === null) {
        return providerFailure<InboundWhatsAppMessage[]>(
          'unauthorized_sender',
          'Unsigned webhook payloads are rejected.',
        )
      }

      const messages = Array.isArray(payload) ? (payload as InboundWhatsAppMessage[]) : []
      return providerOk(messages)
    },

    async verifyWebhook(_rawBody: string, signatureHeader: string | null): Promise<boolean> {
      // Simulated, but still fails closed on a missing signature.
      return signatureHeader === 'sha256=simulated'
    },

    async markAsRead(): Promise<void> {
      // Nothing to acknowledge in a simulation.
    },

    async fetchMedia(): Promise<ProviderResult<Blob>> {
      return providerFailure<Blob>('not_implemented', 'Media download arrives with voice notes.')
    },
  }
}
