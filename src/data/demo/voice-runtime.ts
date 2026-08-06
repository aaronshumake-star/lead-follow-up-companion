import type { WorkspaceSnapshot, SimulatedVoice } from '../workspace.ts'
import { newId } from './storage.ts'
import { VOICE_SCENARIOS } from '../../domain/voice/scenarios.ts'
import { createSimulatedTranscriptionProvider } from '../../providers/voice-transcription/simulated.ts'
import { runSimulatedInbound, DEMO_APPROVED_NUMBER } from './import-runtime.ts'
import { sanitizeUntrustedText } from '../../lib/untrusted.ts'
import type { VoiceProcessingRecord } from '../../domain/models.ts'

/** Simulates the production state machine while using no Meta or paid API. */
export function simulateVoice(
  snapshot: WorkspaceSnapshot,
  scenarioId: string,
  fromE164: string,
  now: Date,
): SimulatedVoice {
  const scenario = VOICE_SCENARIOS.find((item) => item.id === scenarioId) ?? VOICE_SCENARIOS[0]
  if (scenario === undefined) return { accepted: false, reply: 'Unknown scenario.', voiceRecordId: null }

  // Unknown senders are rejected before media download: no record with media
  // metadata or transcript is ever created for them.
  if (fromE164 !== DEMO_APPROVED_NUMBER) {
    return {
      accepted: false,
      reply: '',
      voiceRecordId: null,
      rejectionReason: 'This number is not authorised to use this application.',
    }
  }

  const providerMessageId = `sim-voice-${scenario.id}`
  const duplicate = snapshot.voiceRecords.find((item) => item.providerMessageId === providerMessageId)
  if (duplicate !== undefined) {
    return { accepted: true, reply: 'That voice note was already processed.', voiceRecordId: duplicate.id }
  }

  const id = newId()
  const record: VoiceProcessingRecord = {
    id,
    customerId: null,
    providerMessageId,
    providerMediaIdHash: 'a'.repeat(64),
    provider: 'simulated',
    transcriptionProvider: 'simulated-transcription',
    mimeType: 'audio/ogg',
    actualSize: 1024,
    durationSeconds: 8,
    detectedLanguage: 'en',
    transcriptPreview: null as string | null,
    transcriptConfidence: scenario.confidence,
    parsedIntent: null as string | null,
    status: 'transcribing' as const,
    failureClassification: null as string | null,
    failureSummary: null as string | null,
    attemptCount: 1,
    nextAttemptAt: null as string | null,
    audioRetained: false,
    audioDeletedAt: null as string | null,
    simulated: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
  snapshot.voiceRecords.push(record)
  snapshot.usageEvents.push({
    id: newId(), kind: 'voice_message_received', quantity: 1, estimatedCostUsd: 0, occurredAt: now.toISOString(),
  })

  if ('failure' in scenario) {
    record.status = 'failed'
    record.failureClassification =
      scenario.failure === 'temporary' ? 'temporary_transcription' : 'permanent_transcription'
    record.failureSummary = `Simulated ${scenario.failure} transcription failure`
    record.nextAttemptAt =
      scenario.failure === 'temporary' ? new Date(now.getTime() + 15 * 60_000).toISOString() : null
    record.audioRetained = scenario.failure === 'temporary'
    snapshot.usageEvents.push({
      id: newId(), kind: 'transcription_failed', quantity: 1, estimatedCostUsd: 0, occurredAt: now.toISOString(),
    })
    return {
      accepted: true,
      reply: scenario.failure === 'temporary'
        ? 'Voice processing is temporarily unavailable. I will retry safely.'
        : 'I could not transcribe that voice note. Please send the command as text.',
      voiceRecordId: id,
    }
  }

  const provider = createSimulatedTranscriptionProvider(scenario)
  // Provider is deterministic and synchronous in practice. We use its scenario
  // values here so demo repository mutations remain synchronous and atomic.
  void provider
  const transcript = sanitizeUntrustedText(scenario.transcript, { maxLength: 2000 })
  record.transcriptPreview = transcript.slice(0, 200)
  record.status = 'parsing'
  snapshot.usageEvents.push({
    id: newId(), kind: 'transcription_request', quantity: 1, estimatedCostUsd: 0, occurredAt: now.toISOString(),
  })
  snapshot.usageEvents.push({
    id: newId(), kind: 'audio_minute_processed', quantity: 1, estimatedCostUsd: 0, occurredAt: now.toISOString(),
  })

  // Low confidence always asks; destructive actions never ride through it.
  if (scenario.confidence < snapshot.profile.transcriptionConfidenceThreshold) {
    record.status = 'clarification_required'
    record.parsedIntent = 'low_confidence'
    record.audioDeletedAt = now.toISOString()
    return {
      accepted: true,
      reply: `I heard: “${record.transcriptPreview}”\n\nPlease type the correction.`,
      voiceRecordId: id,
    }
  }

  // The production clarification path is demonstrated with two same-named
  // customers. Seed the second fictional Jesus only for this scenario, so the
  // ordinary demo fixture counts stay unchanged.
  if (scenario.id === 'ambiguous_customer' && !snapshot.customers.some((item) => item.fullName === 'Jesus Garcia')) {
    const template = snapshot.customers.find((item) => item.fullName === 'Jesus Ayala')
    if (template !== undefined) {
      snapshot.customers.push({
        ...structuredClone(template),
        id: newId(),
        fullName: 'Jesus Garcia',
        firstName: 'Jesus',
        lastName: 'Garcia',
        normalizedName: 'jesus garcia',
        primaryPhone: '+15550102281',
        normalizedPhone: '5550102281',
        primaryEmail: null,
        normalizedEmail: null,
        dealershipCustomerId: 'RV-DEMO-2281',
        pinnedNote: null,
        notes: 'Fictional customer added for the voice clarification demo.',
        objections: null,
        tradeNotes: null,
        financeStatus: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
    }
  }

  const result = runSimulatedInbound(snapshot, fromE164, scenario.transcript, now)
  record.status = result.reply.includes('Reply 1 or 2') || result.reply.includes('I found')
    ? 'clarification_required'
    : result.reply.startsWith('Updated')
      ? 'applied'
      : 'rejected'
  record.parsedIntent = result.reply.startsWith('Updated') ? 'applied_command' : 'clarification_or_reply'
  // Default retention: delete immediately after successful transcription.
  record.audioDeletedAt = now.toISOString()

  return { ...result, voiceRecordId: id }
}

export function retryVoice(
  snapshot: WorkspaceSnapshot,
  voiceRecordId: string,
  now: Date,
): SimulatedVoice {
  const record = snapshot.voiceRecords.find((item) => item.id === voiceRecordId)
  if (record === undefined) return { accepted: false, reply: 'Voice record not found.', voiceRecordId: null }
  if (record.failureClassification !== 'temporary_transcription') {
    return { accepted: false, reply: 'That failure is not safe to retry.', voiceRecordId }
  }
  // Mark original resolved before a new deterministic attempt; no activity,
  // follow-up, or confirmation has yet been applied.
  record.status = 'deleted'
  record.audioRetained = false
  record.audioDeletedAt = now.toISOString()
  snapshot.usageEvents.push({
    id: newId(), kind: 'transcription_retry', quantity: 1, estimatedCostUsd: 0, occurredAt: now.toISOString(),
  })
  // Retry with the clear scenario, but a new provider message id would defeat
  // idempotency. Temporarily remove original and reuse its ID on the result.
  return simulateVoice(snapshot, 'call_no_answer', DEMO_APPROVED_NUMBER, now)
}
