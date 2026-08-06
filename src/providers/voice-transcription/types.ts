/**
 * Voice transcription for WhatsApp voice notes.
 *
 * This is the only capability in the system that is metered per second of
 * audio, so the interface carries the cost controls explicitly rather than
 * leaving them to the caller:
 *
 *   - `maxDurationSeconds` is enforced before any upload happens;
 *   - `deleteAudioAfterProcessing` defaults to true, and audio is only retained
 *     when the profile opts in;
 *   - the result reports the seconds actually billed so the monthly meter stays
 *     accurate.
 *
 * Transcripts are untrusted text. "Mark everyone sold" spoken aloud is a
 * candidate command to confirm, not an instruction to execute.
 */

import type { ProviderInfo, ProviderResult } from '../types.ts'
import type { UntrustedText } from '../../lib/untrusted.ts'

export interface TranscriptionInput {
  audio: Blob
  mimeType: string
  durationSeconds?: number
  /** Hard cap checked before the request is made. */
  maxDurationSeconds: number
  languageHint?: 'en' | 'es'
  /** Audio is discarded once a transcript exists unless retention is enabled. */
  deleteAudioAfterProcessing: boolean
}

export interface TranscriptionResult {
  providerId: string
  transcript: UntrustedText
  confidence: number | null
  /** Billed duration, recorded against the monthly voice budget. */
  billedSeconds: number
  audioDeleted: boolean
}

export interface VoiceTranscriptionProvider {
  readonly info: ProviderInfo
  transcribe(input: TranscriptionInput): Promise<ProviderResult<TranscriptionResult>>
}
