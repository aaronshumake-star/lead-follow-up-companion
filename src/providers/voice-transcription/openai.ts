/** Server-only low-cost transcription provider using OpenAI's audio endpoint. */
import { providerFailure, providerOk } from '../types.ts'
import { sanitizeUntrustedText } from '../../lib/untrusted.ts'
import type { TranscriptionResult, VoiceTranscriptionProvider } from './types.ts'

export interface OpenAITranscriptionConfig {
  apiKey: string
  model: string
  fetchImpl?: typeof fetch
}

export function createOpenAITranscriptionProvider(
  config: OpenAITranscriptionConfig,
): VoiceTranscriptionProvider {
  return {
    info: { id: 'openai', displayName: `OpenAI ${config.model}`, isConfigured: true, isBillable: true },
    async transcribe(input) {
      if ((input.durationSeconds ?? 0) > input.maxDurationSeconds) {
        return providerFailure<TranscriptionResult>('invalid_input', 'Voice message exceeds the duration limit.')
      }
      const form = new FormData()
      form.append('file', input.audio, `voice.${extension(input.mimeType)}`)
      form.append('model', config.model)
      form.append('response_format', 'verbose_json')
      if (input.languageHint !== undefined) form.append('language', input.languageHint)
      try {
        const response = await (config.fetchImpl ?? fetch)('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { authorization: `Bearer ${config.apiKey}` },
          body: form,
        })
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500
          return providerFailure<TranscriptionResult>(
            'provider_error',
            `Transcription failed (HTTP ${response.status}).`,
            retryable,
          )
        }
        const data = (await response.json()) as {
          text?: string
          language?: string
          duration?: number
          id?: string
        }
        if (typeof data.text !== 'string' || data.text.trim() === '') {
          return providerFailure('provider_error', 'The transcription provider returned no text.')
        }
        const seconds = data.duration ?? input.durationSeconds ?? 0
        return providerOk({
          providerId: 'openai',
          transcript: sanitizeUntrustedText(data.text, { maxLength: input.maxTranscriptLength ?? 2000 }),
          confidence: null,
          detectedLanguage: data.language ?? null,
          billedSeconds: seconds,
          audioDeleted: input.deleteAudioAfterProcessing,
          providerRequestId: data.id ?? input.requestId ?? null,
          // $0.006/minute is conservative for short audio transcription.
          estimatedCostUsd: Number(((seconds / 60) * 0.006).toFixed(5)),
        })
      } catch {
        return providerFailure('timeout', 'The transcription provider could not be reached.', true)
      }
    },
  }
}

function extension(mime: string): string {
  if (mime.includes('ogg') || mime.includes('opus')) return 'ogg'
  if (mime.includes('mpeg')) return 'mp3'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('webm')) return 'webm'
  return 'mp4'
}
