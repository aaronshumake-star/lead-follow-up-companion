/**
 * Row mapping between PostgreSQL's snake_case and the camelCase domain models.
 *
 * Kept in one place so a schema change surfaces as a handful of compile errors
 * here rather than as silently missing fields spread across the app.
 */

import type {
  Activity,
  AuditEntry,
  ClarificationSession,
  Customer,
  CustomerContactMethod,
  FollowUp,
  NotificationLogEntry,
  Profile,
  Screenshot,
  ScreenshotExtractionField,
  UsageEvent,
  VehicleInterest,
  VoiceProcessingRecord,
} from '../../domain/models.ts'
import type { StoredMatchCandidate } from '../workspace.ts'
import { DEFAULT_SETTINGS } from '../../domain/settings.ts'

type Row = Record<string, unknown>

function text(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function requiredText(row: Row, key: string, fallback = ''): string {
  return text(row, key) ?? fallback
}

function bool(row: Row, key: string, fallback = false): boolean {
  const value = row[key]
  return typeof value === 'boolean' ? value : fallback
}

function num(row: Row, key: string, fallback: number): number {
  const value = row[key]
  return typeof value === 'number' ? value : fallback
}

export function toCustomer(row: Row): Customer {
  return {
    id: requiredText(row, 'id'),
    userId: requiredText(row, 'user_id'),
    fullName: requiredText(row, 'full_name'),
    firstName: text(row, 'first_name'),
    lastName: text(row, 'last_name'),
    normalizedName: text(row, 'normalized_name'),
    primaryPhone: text(row, 'primary_phone'),
    normalizedPhone: text(row, 'normalized_phone'),
    primaryEmail: text(row, 'primary_email'),
    normalizedEmail: text(row, 'normalized_email'),
    dealershipCustomerId: text(row, 'dealership_customer_id'),
    city: text(row, 'city'),
    state: text(row, 'state'),
    preferredLanguage: (text(row, 'preferred_language') ?? 'unknown') as Customer['preferredLanguage'],
    salesperson: text(row, 'salesperson'),
    leadSource: text(row, 'lead_source'),
    leadPriority: (text(row, 'lead_priority') ?? 'normal') as Customer['leadPriority'],
    leadTemperature: (text(row, 'lead_temperature') ?? 'unknown') as Customer['leadTemperature'],
    leadStatus: (text(row, 'lead_status') ?? 'new') as Customer['leadStatus'],
    preferredContactMethod: text(row, 'preferred_contact_method') as Customer['preferredContactMethod'],
    notes: text(row, 'notes'),
    pinnedNote: text(row, 'pinned_note'),
    objections: text(row, 'objections'),
    tradeNotes: text(row, 'trade_notes'),
    financeStatus: text(row, 'finance_status'),
    source: (text(row, 'source') ?? 'manual') as Customer['source'],
    lastActivityAt: text(row, 'last_activity_at'),
    archivedAt: text(row, 'archived_at'),
    createdAt: requiredText(row, 'created_at'),
    updatedAt: requiredText(row, 'updated_at'),
  }
}

export function toContactMethod(row: Row): CustomerContactMethod {
  return {
    id: requiredText(row, 'id'),
    customerId: requiredText(row, 'customer_id'),
    method: (text(row, 'method') ?? 'other') as CustomerContactMethod['method'],
    value: requiredText(row, 'value'),
    label: text(row, 'label'),
    isPrimary: bool(row, 'is_primary'),
    isVerified: bool(row, 'is_verified'),
    optedOut: bool(row, 'opted_out'),
    source: (text(row, 'source') ?? 'manual') as CustomerContactMethod['source'],
  }
}

export function toVehicleInterest(row: Row): VehicleInterest {
  const year = row['model_year']

  return {
    id: requiredText(row, 'id'),
    customerId: requiredText(row, 'customer_id'),
    modelYear: typeof year === 'number' ? year : null,
    make: text(row, 'make'),
    model: text(row, 'model'),
    floorplan: text(row, 'floorplan'),
    stockNumber: text(row, 'stock_number'),
    condition: (text(row, 'condition') ?? 'unknown') as VehicleInterest['condition'],
    isPrimary: bool(row, 'is_primary'),
    notes: text(row, 'notes'),
  }
}

export function toActivity(row: Row): Activity {
  return {
    id: requiredText(row, 'id'),
    customerId: requiredText(row, 'customer_id'),
    type: (text(row, 'type') ?? 'note') as Activity['type'],
    direction: (text(row, 'direction') ?? 'internal') as Activity['direction'],
    method: text(row, 'method') as Activity['method'],
    outcome: text(row, 'outcome') as Activity['outcome'],
    summary: text(row, 'summary'),
    rawText: text(row, 'raw_text'),
    occurredAt: requiredText(row, 'occurred_at'),
    source: (text(row, 'source') ?? 'manual') as Activity['source'],
    performedByUser: bool(row, 'performed_by_user'),
    externalMessageId: text(row, 'external_message_id'),
  }
}

export function toFollowUp(row: Row): FollowUp {
  return {
    id: requiredText(row, 'id'),
    customerId: requiredText(row, 'customer_id'),
    dueAt: requiredText(row, 'due_at'),
    status: (text(row, 'status') ?? 'pending') as FollowUp['status'],
    priority: (text(row, 'priority') ?? 'normal') as FollowUp['priority'],
    reason: text(row, 'reason'),
    recommendedMethod: text(row, 'recommended_method') as FollowUp['recommendedMethod'],
    waitingUntil: text(row, 'waiting_until'),
    completedAt: text(row, 'completed_at'),
    snoozedUntil: text(row, 'snoozed_until'),
    reminderStatus: (text(row, 'reminder_status') ?? 'not_scheduled') as FollowUp['reminderStatus'],
    whatsappMessageId: text(row, 'whatsapp_message_id'),
    isAppointment: bool(row, 'is_appointment'),
    canceledAt: text(row, 'canceled_at'),
    outcomeNote: text(row, 'outcome_note'),
    rescheduledFromId: text(row, 'rescheduled_from_id'),
    createdAt: requiredText(row, 'created_at'),
  }
}

export function toAuditEntry(row: Row): AuditEntry {
  const metadata = row['metadata']

  return {
    id: requiredText(row, 'id'),
    action: (text(row, 'action') ?? 'update') as AuditEntry['action'],
    tableName: requiredText(row, 'table_name'),
    recordId: text(row, 'record_id'),
    summary: text(row, 'summary'),
    metadata: typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : {},
    createdAt: requiredText(row, 'created_at'),
  }
}

/**
 * Trailing seconds are trimmed from `time` columns so the value round-trips
 * through an `<input type="time">` without gaining ":00" on every save.
 */
function timeOfDay(row: Row, key: string, fallback: string): string {
  const value = text(row, key)
  return value === null ? fallback : value.slice(0, 5)
}

export function toProfile(row: Row): Profile {
  return {
    id: requiredText(row, 'id'),
    displayName: text(row, 'display_name'),
    whatsappNumberE164: text(row, 'whatsapp_number_e164'),
    whatsappEnabled: bool(row, 'whatsapp_enabled'),
    monthlyMessageBudget: num(row, 'monthly_message_budget', 300),
    aiExtractionEnabled: bool(row, 'ai_extraction_enabled'),
    voiceTranscriptionEnabled: bool(row, 'voice_transcription_enabled'),
    monthlyVoiceMinuteBudget: num(row, 'monthly_voice_minute_budget', 30),
    retainScreenshots: bool(row, 'retain_screenshots'),
    retainVoiceAudio: bool(row, 'retain_voice_audio'),

    timeZone: requiredText(row, 'time_zone', DEFAULT_SETTINGS.timeZone),
    morningAt: timeOfDay(row, 'morning_at', DEFAULT_SETTINGS.morningAt),
    afternoonAt: timeOfDay(row, 'afternoon_at', DEFAULT_SETTINGS.afternoonAt),
    noAnswerFollowUpHours: num(row, 'no_answer_follow_up_hours', DEFAULT_SETTINGS.noAnswerFollowUpHours),
    voicemailFollowUpHours: num(row, 'voicemail_follow_up_hours', DEFAULT_SETTINGS.voicemailFollowUpHours),
    textNoReplyFollowUpHours: num(
      row,
      'text_no_reply_follow_up_hours',
      DEFAULT_SETTINGS.textNoReplyFollowUpHours,
    ),
    emailNoReplyFollowUpHours: num(
      row,
      'email_no_reply_follow_up_hours',
      DEFAULT_SETTINGS.emailNoReplyFollowUpHours,
    ),
    quoteSentFollowUpHours: num(row, 'quote_sent_follow_up_hours', DEFAULT_SETTINGS.quoteSentFollowUpHours),
    waitingTimeoutHours: num(row, 'waiting_timeout_hours', DEFAULT_SETTINGS.waitingTimeoutHours),
    defaultLeadPriority: (text(row, 'default_lead_priority') ??
      DEFAULT_SETTINGS.defaultLeadPriority) as Profile['defaultLeadPriority'],
    dateTimeDisplay: (text(row, 'date_time_display') ??
      DEFAULT_SETTINGS.dateTimeDisplay) as Profile['dateTimeDisplay'],

    autoImportEnabled: bool(row, 'auto_import_enabled', DEFAULT_SETTINGS.autoImportEnabled),
    autoFollowUpOnImport: bool(row, 'auto_follow_up_on_import', DEFAULT_SETTINGS.autoFollowUpOnImport),
    newLeadSameDayCutoffHour: num(
      row,
      'new_lead_same_day_cutoff_hour',
      DEFAULT_SETTINGS.newLeadSameDayCutoffHour,
    ),
    sameDayFollowUpDelayHours: num(
      row,
      'same_day_follow_up_delay_hours',
      DEFAULT_SETTINGS.sameDayFollowUpDelayHours,
    ),

    remindersEnabled: bool(row, 'reminders_enabled', DEFAULT_SETTINGS.remindersEnabled),
    individualRemindersEnabled: bool(
      row,
      'individual_reminders_enabled',
      DEFAULT_SETTINGS.individualRemindersEnabled,
    ),
    digestOnly: bool(row, 'digest_only', DEFAULT_SETTINGS.digestOnly),
    morningDigestEnabled: bool(row, 'morning_digest_enabled', DEFAULT_SETTINGS.morningDigestEnabled),
    endOfDayDigestEnabled: bool(
      row,
      'end_of_day_digest_enabled',
      DEFAULT_SETTINGS.endOfDayDigestEnabled,
    ),
    endOfDayDigestAt: timeOfDay(row, 'end_of_day_digest_at', DEFAULT_SETTINGS.endOfDayDigestAt),
    appointmentReminderLeadHours: num(
      row,
      'appointment_reminder_lead_hours',
      DEFAULT_SETTINGS.appointmentReminderLeadHours,
    ),
    overdueReminderIntervalHours: num(
      row,
      'overdue_reminder_interval_hours',
      DEFAULT_SETTINGS.overdueReminderIntervalHours,
    ),
    reminderMaxAttempts: num(row, 'reminder_max_attempts', DEFAULT_SETTINGS.reminderMaxAttempts),

    annualCostThresholdUsd: num(
      row,
      'annual_cost_threshold_usd',
      DEFAULT_SETTINGS.annualCostThresholdUsd,
    ),
    voiceMessagesPerDay: num(row, 'voice_messages_per_day', DEFAULT_SETTINGS.voiceMessagesPerDay),
    transcriptionConfidenceThreshold:
      numberOrNull(row, 'transcription_confidence_threshold') ??
      DEFAULT_SETTINGS.transcriptionConfidenceThreshold,
    failedAudioRetentionHours: num(
      row,
      'failed_audio_retention_hours',
      DEFAULT_SETTINGS.failedAudioRetentionHours,
    ),
    retainFailedTranscripts: bool(
      row,
      'retain_failed_transcripts',
      DEFAULT_SETTINGS.retainFailedTranscripts,
    ),
  }
}

function numberOrNull(row: Row, key: string): number | null {
  const value = row[key]
  if (typeof value === 'number') return value
  // PostgREST returns numeric columns as strings to preserve precision.
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function stringArray(row: Row, key: string): string[] {
  const value = row[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function toScreenshot(row: Row): Screenshot {
  return {
    id: requiredText(row, 'id'),
    customerId: text(row, 'customer_id'),
    fileHash: requiredText(row, 'file_hash'),
    mimeType: requiredText(row, 'mime_type', 'image/png'),
    byteSize: num(row, 'byte_size', 0),
    status: (text(row, 'status') ?? 'uploaded') as Screenshot['status'],
    extractionProvider: text(row, 'extraction_provider'),
    rawText: text(row, 'raw_text'),
    capturedAt: text(row, 'captured_at'),
    createdAt: requiredText(row, 'created_at'),
    decision: text(row, 'decision') as Screenshot['decision'],
    decisionReason: text(row, 'decision_reason'),
    overallConfidence: numberOrNull(row, 'overall_confidence'),
    warnings: stringArray(row, 'warnings'),
    containsMultipleCustomers: bool(row, 'contains_multiple_customers'),
    imageWidth: numberOrNull(row, 'image_width'),
    imageHeight: numberOrNull(row, 'image_height'),
    originalFilename: text(row, 'original_filename'),
    retained: bool(row, 'retained'),
    reviewResolvedAt: text(row, 'review_resolved_at'),
    reviewAction: text(row, 'review_action'),
  }
}

export function toExtractionField(row: Row): ScreenshotExtractionField {
  const accepted = row['accepted']

  return {
    id: requiredText(row, 'id'),
    screenshotId: requiredText(row, 'screenshot_id'),
    fieldKey: requiredText(row, 'field_key'),
    fieldValue: text(row, 'field_value'),
    confidence: numberOrNull(row, 'confidence'),
    accepted: typeof accepted === 'boolean' ? accepted : null,
    verified: bool(row, 'verified'),
    appliedAsUnverified: bool(row, 'applied_as_unverified'),
  }
}

export function toStoredMatchCandidate(row: Row): StoredMatchCandidate {
  const signals = row['match_signals']

  return {
    id: requiredText(row, 'id'),
    screenshotId: requiredText(row, 'screenshot_id'),
    customerId: requiredText(row, 'customer_id'),
    score: numberOrNull(row, 'score') ?? 0,
    reasons:
      typeof signals === 'object' && signals !== null && Array.isArray((signals as { reasons?: unknown }).reasons)
        ? ((signals as { reasons: string[] }).reasons ?? [])
        : [],
    conflicts:
      typeof signals === 'object' && signals !== null && Array.isArray((signals as { conflicts?: unknown }).conflicts)
        ? ((signals as { conflicts: Array<{ field: string; existing: string; incoming: string }> }).conflicts ?? [])
        : [],
    selected: bool(row, 'selected'),
  }
}

export function toNotification(row: Row): NotificationLogEntry {
  return {
    id: requiredText(row, 'id'),
    customerId: text(row, 'customer_id'),
    followUpId: text(row, 'follow_up_id'),
    kind: (text(row, 'kind') ?? 'system_alert') as NotificationLogEntry['kind'],
    status: (text(row, 'status') ?? 'queued') as NotificationLogEntry['status'],
    idempotencyKey: requiredText(row, 'idempotency_key'),
    reminderStage: text(row, 'reminder_stage') as NotificationLogEntry['reminderStage'],
    payloadSummary: text(row, 'payload_summary'),
    billable: bool(row, 'billable', true),
    attemptCount: num(row, 'attempt_count', 0),
    error: text(row, 'error'),
    permanentFailure: bool(row, 'permanent_failure'),
    nextAttemptAt: text(row, 'next_attempt_at'),
    sentAt: text(row, 'sent_at'),
    createdAt: requiredText(row, 'created_at'),
  }
}

export function toClarificationSession(row: Row): ClarificationSession {
  const options = row['options']
  const payload = row['pending_payload']

  return {
    id: requiredText(row, 'id'),
    kind: requiredText(row, 'kind'),
    prompt: requiredText(row, 'prompt'),
    options: Array.isArray(options) ? (options as ClarificationSession['options']) : [],
    pendingPayload:
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {},
    expiresAt: requiredText(row, 'expires_at'),
    resolvedAt: text(row, 'resolved_at'),
    resolution: text(row, 'resolution'),
    createdAt: requiredText(row, 'created_at'),
  }
}

export function toUsageEvent(row: Row): UsageEvent {
  return {
    id: requiredText(row, 'id'),
    kind: (text(row, 'kind') ?? 'ocr_job') as UsageEvent['kind'],
    quantity: num(row, 'quantity', 1),
    estimatedCostUsd: numberOrNull(row, 'estimated_cost_usd') ?? 0,
    occurredAt: requiredText(row, 'occurred_at'),
  }
}

export function toVoiceRecord(row: Row): VoiceProcessingRecord {
  return {
    id: requiredText(row, 'id'),
    customerId: text(row, 'customer_id'),
    providerMessageId: requiredText(row, 'provider_message_id'),
    providerMediaIdHash: text(row, 'provider_media_id_hash'),
    provider: requiredText(row, 'provider', 'whatsapp_cloud'),
    transcriptionProvider: text(row, 'transcription_provider'),
    mimeType: text(row, 'mime_type'),
    actualSize: numberOrNull(row, 'actual_size'),
    durationSeconds: numberOrNull(row, 'duration_seconds'),
    detectedLanguage: text(row, 'detected_language'),
    transcriptPreview: text(row, 'transcript_preview'),
    transcriptConfidence: numberOrNull(row, 'transcript_confidence'),
    parsedIntent: text(row, 'parsed_intent'),
    status: requiredText(row, 'status', 'received') as VoiceProcessingRecord['status'],
    failureClassification: text(row, 'failure_classification'),
    failureSummary: text(row, 'failure_summary'),
    attemptCount: num(row, 'attempt_count', 0),
    nextAttemptAt: text(row, 'next_attempt_at'),
    audioRetained: text(row, 'audio_storage_path') !== null && text(row, 'audio_deleted_at') === null,
    audioDeletedAt: text(row, 'audio_deleted_at'),
    simulated: bool(row, 'simulated'),
    createdAt: requiredText(row, 'created_at'),
    updatedAt: requiredText(row, 'updated_at'),
  }
}

/** Drops undefined keys so a patch never overwrites a column with null by accident. */
export function definedOnly(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined))
}
