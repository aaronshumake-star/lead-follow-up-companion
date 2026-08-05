import type { ProviderInfo, ProviderResult } from '../types.ts'
import { notConfigured, providerFailure } from '../types.ts'
import type {
  InboundWhatsAppMessage,
  OutboundWhatsAppMessage,
  SendResult,
  WhatsAppProvider,
} from './types.ts'

/**
 * Phase 1 placeholder that fails closed.
 *
 * Nothing is sent, no webhook payload is trusted, and no media is fetched. The
 * dashboard is the fallback surface while WhatsApp is unavailable, which is the
 * same behaviour the app needs during a real provider outage — so this stub
 * exercises the degraded path rather than hiding it.
 */
export const unconfiguredWhatsAppProvider: WhatsAppProvider = {
  info: {
    id: 'unconfigured',
    displayName: 'Not configured',
    isConfigured: false,
    isBillable: false,
  } satisfies ProviderInfo,

  async send(_message: OutboundWhatsAppMessage): Promise<ProviderResult<SendResult>> {
    return notConfigured<SendResult>('WhatsApp messaging')
  },

  parseWebhook(_payload: unknown, _signature: string | null): ProviderResult<InboundWhatsAppMessage[]> {
    // An unverifiable payload is rejected outright rather than parsed
    // optimistically: untrusted input gets no benefit of the doubt.
    return providerFailure<InboundWhatsAppMessage[]>(
      'not_configured',
      'No WhatsApp provider configured, so webhook signatures cannot be verified.',
    )
  },

  async fetchMedia(_mediaId: string): Promise<ProviderResult<Blob>> {
    return notConfigured<Blob>('WhatsApp media download')
  },
}
