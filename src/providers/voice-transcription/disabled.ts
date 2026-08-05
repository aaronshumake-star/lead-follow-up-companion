import type { ProviderInfo, ProviderResult } from '../types.ts'
import { providerFailure } from '../types.ts'
import type { TranscriptionInput, TranscriptionResult, VoiceTranscriptionProvider } from './types.ts'

/**
 * Default provider: transcription is off.
 *
 * Voice is the one capability billed per second, so it stays disabled until it
 * is deliberately switched on in Settings. The error code is 'disabled' rather
 * than 'not_configured' to say this is a choice, not an oversight.
 */
export const disabledVoiceTranscriptionProvider: VoiceTranscriptionProvider = {
  info: {
    id: 'disabled',
    displayName: 'Disabled',
    isConfigured: false,
    isBillable: false,
  } satisfies ProviderInfo,

  async transcribe(_input: TranscriptionInput): Promise<ProviderResult<TranscriptionResult>> {
    return providerFailure<TranscriptionResult>(
      'disabled',
      'Voice transcription is turned off. Enable it in Settings to process voice notes.',
    )
  },
}
