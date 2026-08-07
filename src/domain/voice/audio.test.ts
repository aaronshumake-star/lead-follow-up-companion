import { describe, expect, it } from 'vitest'
import { normalizeAudioMime, validateAudio } from './audio.ts'
import { createSimulatedTranscriptionProvider } from '../../providers/voice-transcription/simulated.ts'

const ogg = new TextEncoder().encode('OggS' + 'x'.repeat(100))
const limits = { maxBytes: 1000, maxSeconds: 120 }

describe('voice audio validation', () => {
  it('accepts a supported signed file', () => {
    expect(validateAudio(ogg, 'audio/ogg', 10, limits).ok).toBe(true)
  })
  it('accepts and normalizes Meta voice-note MIME parameters', () => {
    expect(normalizeAudioMime('audio/ogg; codecs=opus')).toBe('audio/ogg')
    expect(validateAudio(ogg, 'audio/ogg; codecs=opus', 10, limits)).toMatchObject({
      ok: true,
      mimeType: 'audio/ogg',
    })
  })
  it('rejects unsupported, corrupt, oversized and overlong audio', () => {
    expect(validateAudio(ogg, 'audio/flac', 10, limits)).toMatchObject({ ok: false, classification: 'unsupported_media' })
    expect(validateAudio(new Uint8Array([1, 2, 3, 4]), 'audio/ogg', 10, limits)).toMatchObject({ ok: false, classification: 'corrupt_media' })
    expect(validateAudio(new Uint8Array(1001).fill(1), 'audio/ogg', 10, limits)).toMatchObject({ ok: false, classification: 'oversized' })
    expect(validateAudio(ogg, 'audio/ogg', 121, limits)).toMatchObject({ ok: false, classification: 'duration_exceeded' })
  })
})

describe('simulated transcription', () => {
  it('sanitizes and caps the transcript with language and confidence', async () => {
    const provider = createSimulatedTranscriptionProvider({
      transcript: 'Called Jesus\u0000 Ayala. No answer.',
      confidence: 0.91,
      language: 'en',
    })
    const result = await provider.transcribe({
      audio: new Blob([ogg]), mimeType: 'audio/ogg', durationSeconds: 8,
      maxDurationSeconds: 120, maxTranscriptLength: 20, deleteAudioAfterProcessing: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.transcript.length).toBeLessThanOrEqual(20)
      expect(result.value.transcript).not.toContain('\u0000')
      expect(result.value.detectedLanguage).toBe('en')
      expect(result.value.audioDeleted).toBe(true)
      expect(result.value.estimatedCostUsd).toBe(0)
    }
  })
  it('classifies temporary and permanent failures', async () => {
    for (const failure of ['temporary', 'permanent'] as const) {
      const result = await createSimulatedTranscriptionProvider({
        transcript: '', confidence: 0, failure,
      }).transcribe({
        audio: new Blob([ogg]), mimeType: 'audio/ogg',
        maxDurationSeconds: 120, deleteAudioAfterProcessing: true,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.retryable).toBe(failure === 'temporary')
    }
  })
})
