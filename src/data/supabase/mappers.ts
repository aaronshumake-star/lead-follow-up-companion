/**
 * Row mapping between PostgreSQL's snake_case and the camelCase domain models.
 *
 * Kept in one place so a schema change surfaces as a handful of compile errors
 * here rather than as silently missing fields spread across the app.
 */

import type {
  Activity,
  AuditEntry,
  Customer,
  CustomerContactMethod,
  FollowUp,
  Profile,
  VehicleInterest,
} from '../../domain/models.ts'
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
  }
}

/** Drops undefined keys so a patch never overwrites a column with null by accident. */
export function definedOnly(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined))
}
