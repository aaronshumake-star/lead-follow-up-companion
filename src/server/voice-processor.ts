import type { VoiceTranscriptionProvider } from '../providers/voice-transcription/types.ts'
import type { WhatsAppProvider } from '../providers/whatsapp/types.ts'
import { isApprovedSender } from '../providers/whatsapp/types.ts'
import { hashSafeReference, normalizeAudioMime, validateAudio } from '../domain/voice/audio.ts'
import { handleInboundText } from './webhook-router.ts'
import type { AccountContext, MessagingPort, WebhookStore } from './ports.ts'

export interface VoiceMessage {
  providerMessageId: string
  providerMediaId: string
  fromE164: string
  mimeType: string
  durationSeconds: number | null
  receivedAt: string
}

export async function processVoiceMessage(
  store: WebhookStore,
  messaging: MessagingPort,
  whatsapp: WhatsAppProvider,
  transcription: VoiceTranscriptionProvider | null,
  account: AccountContext,
  message: VoiceMessage,
  limits: { maxBytes: number; maxSeconds: number; transcriptMaxLength: number; confidenceThreshold: number },
): Promise<{ kind: string; reply?: string }> {
  // Authentication and sender checks happen before media retrieval.
  if (!isApprovedSender(message.fromE164, account.approvedNumberE164)) {
    await store.writeAudit(account.userId, 'Rejected voice message from unknown sender', {
      reason: 'unapproved_sender',
    })
    return { kind: 'rejected_sender' }
  }

  const hash = await hashSafeReference(message.providerMediaId)
  const normalizedMimeType = normalizeAudioMime(message.mimeType)
  const voiceId = await store.claimVoice({
    userId: account.userId,
    providerMessageId: message.providerMessageId,
    providerMediaIdHash: hash,
    mimeType: normalizedMimeType,
    simulated: false,
  })
  if (voiceId === null) return { kind: 'duplicate' }

  if (transcription === null || !transcription.info.isConfigured) {
    await store.updateVoice(voiceId, {
      status: 'failed',
      failure_classification: 'transcription_disabled',
      failure_summary: 'Voice transcription is disabled or unconfigured.',
    })
    return { kind: 'unavailable', reply: 'Voice processing is unavailable. Please send the command as text.' }
  }

  await store.updateVoice(voiceId, { status: 'media_fetching' })
  let media = await whatsapp.fetchMedia(message.providerMediaId)
  if (!media.ok && media.error.retryable) {
    await store.updateVoice(voiceId, { attempt_count: 1, status: 'media_fetching' })
    media = await whatsapp.fetchMedia(message.providerMediaId)
  }
  if (!media.ok) {
    await store.updateVoice(voiceId, {
      status: 'failed',
      failure_classification: media.error.retryable ? 'temporary_download' : 'permanent_download',
      failure_summary: media.error.message,
      next_attempt_at: media.error.retryable ? new Date(Date.now() + 15 * 60_000).toISOString() : null,
    })
    return { kind: 'media_failure', reply: media.error.retryable ? 'Voice download failed temporarily. I will retry.' : 'I could not download that voice note.' }
  }

  const bytes = new Uint8Array(await media.value.arrayBuffer())
  const validation = validateAudio(
    bytes,
    media.value.type || normalizedMimeType,
    message.durationSeconds,
    {
    maxBytes: limits.maxBytes,
    maxSeconds: limits.maxSeconds,
    },
  )
  if (!validation.ok) {
    await store.updateVoice(voiceId, {
      status: 'rejected',
      failure_classification: validation.classification,
      failure_summary: validation.message,
      actual_size: bytes.length,
    })
    return { kind: 'invalid_media', reply: validation.message }
  }

  await store.updateVoice(voiceId, {
    status: 'transcribing',
    actual_size: bytes.length,
    duration_seconds: validation.durationSeconds,
  })
  const transcribeInput = {
    audio: media.value,
    mimeType: validation.mimeType,
    durationSeconds: validation.durationSeconds ?? undefined,
    maxDurationSeconds: limits.maxSeconds,
    maxTranscriptLength: limits.transcriptMaxLength,
    languageHint: 'en' as const,
    requestId: voiceId,
    deleteAudioAfterProcessing: true,
  }
  let transcribed = await transcription.transcribe(transcribeInput)
  if (!transcribed.ok && transcribed.error.retryable) {
    await store.updateVoice(voiceId, { attempt_count: 2, status: 'transcribing' })
    transcribed = await transcription.transcribe(transcribeInput)
  }
  if (!transcribed.ok) {
    await store.updateVoice(voiceId, {
      status: 'failed',
      failure_classification: transcribed.error.retryable ? 'temporary_transcription' : 'permanent_transcription',
      failure_summary: transcribed.error.message,
      next_attempt_at: transcribed.error.retryable ? new Date(Date.now() + 15 * 60_000).toISOString() : null,
    })
    return { kind: 'transcription_failure', reply: transcribed.error.retryable ? 'Transcription failed temporarily. I will retry safely.' : 'I could not transcribe that voice note. Please send the command as text.' }
  }

  const preview = transcribed.value.transcript.slice(0, 200)
  await store.updateVoice(voiceId, {
    status: 'parsing',
    transcription_provider: transcribed.value.providerId,
    transcription_request_id: transcribed.value.providerRequestId ?? null,
    transcript_preview: preview,
    transcript_confidence: transcribed.value.confidence,
    detected_language: transcribed.value.detectedLanguage ?? null,
    audio_deleted_at: new Date().toISOString(),
  })

  if (
    transcribed.value.confidence !== null &&
    transcribed.value.confidence < limits.confidenceThreshold
  ) {
    await store.updateVoice(voiceId, { status: 'clarification_required', failure_classification: 'low_confidence' })
    return { kind: 'clarification', reply: `I heard: “${preview}”\n\nPlease type the correction.` }
  }

  const applied = await handleInboundText(
    store,
    messaging,
    account,
    {
      providerMessageId: `${message.providerMessageId}:transcript`,
      fromE164: message.fromE164,
      text: transcribed.value.transcript,
      receivedAt: message.receivedAt,
    },
  )
  await store.updateVoice(voiceId, {
    status: applied.kind === 'applied' ? 'applied' : applied.kind === 'asked' ? 'clarification_required' : 'rejected',
    customer_id: applied.kind === 'applied' ? applied.customerId : null,
    parsed_intent: applied.kind,
  })
  return applied
}
