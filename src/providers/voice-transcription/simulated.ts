import { providerFailure, providerOk } from '../types.ts'
import { sanitizeUntrustedText } from '../../lib/untrusted.ts'
import type { TranscriptionInput, TranscriptionResult, VoiceTranscriptionProvider } from './types.ts'

export interface SimulatedTranscript {
  transcript: string
  confidence: number
  language?: string
  failure?: 'temporary' | 'permanent'
}

export function createSimulatedTranscriptionProvider(
  scenario: SimulatedTranscript,
): VoiceTranscriptionProvider {
  return {
    info: { id: 'simulated-transcription', displayName: 'Simulated transcription (demo)', isConfigured: true, isBillable: false },
    async transcribe(input: TranscriptionInput) {
      if ((input.durationSeconds ?? 0) > input.maxDurationSeconds) {
        return providerFailure<TranscriptionResult>('invalid_input', 'Voice message exceeds the duration limit.')
      }
      if (scenario.failure !== undefined) {
        return providerFailure<TranscriptionResult>(
          'provider_error',
          `Simulated ${scenario.failure} transcription failure.`,
          scenario.failure === 'temporary',
        )
      }
      const max = input.maxTranscriptLength ?? 2000
      const transcript = sanitizeUntrustedText(scenario.transcript, { maxLength: max })
      return providerOk({
        providerId: 'simulated-transcription',
        transcript,
        confidence: scenario.confidence,
        detectedLanguage: scenario.language ?? 'en',
        billedSeconds: input.durationSeconds ?? 0,
        audioDeleted: input.deleteAudioAfterProcessing,
        providerRequestId: input.requestId ?? null,
        estimatedCostUsd: 0,
      })
    },
  }
}
