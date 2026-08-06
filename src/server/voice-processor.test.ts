import { describe, expect, it, vi } from 'vitest'
import { MemoryMessaging, MemoryStore } from './memory-store.ts'
import { processVoiceMessage } from './voice-processor.ts'
import { createSimulatedTranscriptionProvider } from '../providers/voice-transcription/simulated.ts'
import type { WhatsAppProvider } from '../providers/whatsapp/types.ts'
import { providerOk } from '../providers/types.ts'
import { makeCustomer } from '../test-support/factories.ts'
import { DEFAULT_SETTINGS } from '../domain/settings.ts'

const APPROVED = '+15550100999'
const ogg = new Blob([new TextEncoder().encode('OggS' + 'x'.repeat(100))], { type: 'audio/ogg' })

function whatsapp(fetchMedia = vi.fn(async () => providerOk(ogg))): WhatsAppProvider {
  return {
    info: { id: 'fake', displayName: 'Fake', isConfigured: true, isBillable: false },
    send: vi.fn(),
    parseWebhook: vi.fn(),
    fetchMedia,
  } as unknown as WhatsAppProvider
}

function args(from = APPROVED, id = 'voice-1') {
  return {
    providerMessageId: id, providerMediaId: 'media-12345', fromE164: from,
    mimeType: 'audio/ogg', durationSeconds: 8, receivedAt: new Date().toISOString(),
  }
}

const limits = { maxBytes: 1000, maxSeconds: 120, transcriptMaxLength: 2000, confidenceThreshold: 0.65 }

describe('voice processing', () => {
  it('rejects an unknown sender before downloading media', async () => {
    const fetchMedia = vi.fn(async () => providerOk(ogg))
    const store = new MemoryStore()
    const result = await processVoiceMessage(
      store, new MemoryMessaging(), whatsapp(fetchMedia),
      createSimulatedTranscriptionProvider({ transcript: 'What is overdue?', confidence: 1 }),
      { userId: store.userId, settings: DEFAULT_SETTINGS, approvedNumberE164: APPROVED, remindersEnabled: true },
      args('+15550100777'), limits,
    )
    expect(result.kind).toBe('rejected_sender')
    expect(fetchMedia).not.toHaveBeenCalled()
  })

  it('applies a clear transcript once and deletes audio metadata', async () => {
    const store = new MemoryStore({
      customers: [makeCustomer({ id: 'jesus', fullName: 'Jesus Ayala', leadStatus: 'working' })],
    })
    const result = await processVoiceMessage(
      store, new MemoryMessaging(), whatsapp(),
      createSimulatedTranscriptionProvider({
        transcript: 'Called Jesus Ayala. No answer. Follow up tomorrow morning.',
        confidence: 0.96,
      }),
      { userId: store.userId, settings: DEFAULT_SETTINGS, approvedNumberE164: APPROVED, remindersEnabled: true },
      args(), limits,
    )
    expect(result.kind).toBe('applied')
    expect(store.appliedEffects).toHaveLength(1)
    expect(store.voiceRecords[0]?.patch['audio_deleted_at']).toBeDefined()

    const duplicate = await processVoiceMessage(
      store, new MemoryMessaging(), whatsapp(),
      createSimulatedTranscriptionProvider({ transcript: 'Called Jesus Ayala.', confidence: 1 }),
      { userId: store.userId, settings: DEFAULT_SETTINGS, approvedNumberE164: APPROVED, remindersEnabled: true },
      args(), limits,
    )
    expect(duplicate.kind).toBe('duplicate')
    expect(store.appliedEffects).toHaveLength(1)
  })

  it('asks for clarification on low confidence and does not apply', async () => {
    const store = new MemoryStore({
      customers: [makeCustomer({ id: 'jesus', fullName: 'Jesus Ayala' })],
    })
    const result = await processVoiceMessage(
      store, new MemoryMessaging(), whatsapp(),
      createSimulatedTranscriptionProvider({ transcript: 'Mark Jesus Ayala sold.', confidence: 0.2 }),
      { userId: store.userId, settings: DEFAULT_SETTINGS, approvedNumberE164: APPROVED, remindersEnabled: true },
      args(), limits,
    )
    expect(result.kind).toBe('clarification')
    expect(store.appliedEffects).toHaveLength(0)
  })

  it('fails safely when transcription is disabled', async () => {
    const store = new MemoryStore()
    const result = await processVoiceMessage(
      store, new MemoryMessaging(), whatsapp(), null,
      { userId: store.userId, settings: DEFAULT_SETTINGS, approvedNumberE164: APPROVED, remindersEnabled: true },
      args(), limits,
    )
    expect(result.kind).toBe('unavailable')
    expect(store.voiceRecords[0]?.status).toBe('failed')
  })

  it('retries a temporary transcription once without duplicate activity', async () => {
    const store = new MemoryStore({
      customers: [makeCustomer({ id: 'jesus', fullName: 'Jesus Ayala', leadStatus: 'working' })],
    })
    const good = createSimulatedTranscriptionProvider({
      transcript: 'Called Jesus Ayala. No answer. Follow up tomorrow morning.',
      confidence: 0.96,
    })
    let calls = 0
    const provider = {
      ...good,
      async transcribe(input: Parameters<typeof good.transcribe>[0]) {
        calls += 1
        if (calls === 1) {
          return {
            ok: false as const,
            error: { code: 'provider_error' as const, message: 'temporary', retryable: true },
          }
        }
        return good.transcribe(input)
      },
    }
    const result = await processVoiceMessage(
      store, new MemoryMessaging(), whatsapp(), provider,
      { userId: store.userId, settings: DEFAULT_SETTINGS, approvedNumberE164: APPROVED, remindersEnabled: true },
      args(), limits,
    )
    expect(result.kind).toBe('applied')
    expect(calls).toBe(2)
    expect(store.appliedEffects).toHaveLength(1)
  })
})
