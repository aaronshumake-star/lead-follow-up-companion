/**
 * The domain vocabulary, mirroring the PostgreSQL enums in
 * supabase/migrations/20260805000100_enums_and_helpers.sql.
 *
 * Written as const arrays rather than TypeScript enums so the values survive
 * type erasure and can be iterated for form options and validation.
 */

export const LEAD_STATUSES = [
  'new',
  'working',
  'follow_up_scheduled',
  'waiting_on_customer',
  'appointment_scheduled',
  'sold',
  'lost',
  'do_not_contact',
  'archived',
] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

/**
 * Statuses that end the follow-up obligation. A customer in any other status
 * needs an open follow-up or it lands in the no-next-action queue.
 */
export const CLOSED_LEAD_STATUSES = ['sold', 'lost', 'do_not_contact', 'archived'] as const
export type ClosedLeadStatus = (typeof CLOSED_LEAD_STATUSES)[number]

export const LEAD_TEMPERATURES = ['hot', 'warm', 'cold', 'unknown'] as const
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number]

export const LEAD_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
export type LeadPriority = (typeof LEAD_PRIORITIES)[number]

export const PREFERRED_LANGUAGES = ['en', 'es', 'other', 'unknown'] as const
export type PreferredLanguage = (typeof PREFERRED_LANGUAGES)[number]

export const CONTACT_METHODS = [
  'phone_call',
  'sms',
  'email',
  'whatsapp',
  'voicemail',
  'in_person',
  'other',
] as const
export type ContactMethod = (typeof CONTACT_METHODS)[number]

export const ACTIVITY_TYPES = [
  'outbound_call',
  'inbound_call',
  'outbound_text',
  'inbound_text',
  'outbound_email',
  'inbound_email',
  'voicemail_left',
  'voicemail_received',
  'whatsapp_message',
  'in_person',
  'appointment',
  'note',
  'status_change',
  'follow_up_completed',
  'screenshot_import',
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export const ACTIVITY_DIRECTIONS = ['outbound', 'inbound', 'internal'] as const
export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[number]

export const ACTIVITY_OUTCOMES = [
  'connected',
  'no_answer',
  'left_voicemail',
  'busy',
  'bad_number',
  'wrong_number',
  'replied',
  'no_reply',
  'appointment_set',
  'appointment_kept',
  'appointment_missed',
  'not_interested',
  'sold',
  'other',
] as const
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number]

export const RECORD_SOURCES = ['manual', 'screenshot', 'whatsapp', 'voice_note', 'seed', 'system'] as const
export type RecordSource = (typeof RECORD_SOURCES)[number]

/** Sources whose text originated outside the app and must be treated as untrusted. */
export const UNTRUSTED_SOURCES = ['screenshot', 'whatsapp', 'voice_note'] as const

export const FOLLOW_UP_STATUSES = [
  'pending',
  'snoozed',
  'completed',
  'canceled',
  'overdue',
  'waiting_on_customer',
] as const
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number]

/** Statuses that still represent an outstanding commitment. */
export const OPEN_FOLLOW_UP_STATUSES = ['pending', 'snoozed', 'overdue', 'waiting_on_customer'] as const

export const REMINDER_STATUSES = [
  'not_scheduled',
  'scheduled',
  'sent',
  'failed',
  'suppressed',
  'acknowledged',
] as const
export type ReminderStatus = (typeof REMINDER_STATUSES)[number]

export const SCREENSHOT_STATUSES = [
  'uploaded',
  'extracting',
  'needs_review',
  'applied',
  'discarded',
  'failed',
] as const
export type ScreenshotStatus = (typeof SCREENSHOT_STATUSES)[number]

export const VEHICLE_CONDITIONS = ['new', 'used', 'unknown'] as const
export type VehicleCondition = (typeof VEHICLE_CONDITIONS)[number]

export const NOTIFICATION_KINDS = [
  'follow_up_reminder',
  'morning_summary',
  'overdue_summary',
  'command_confirmation',
  'command_error',
  'system_alert',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export const NOTIFICATION_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed', 'suppressed'] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

export const INBOUND_COMMAND_CHANNELS = ['whatsapp_text', 'whatsapp_voice', 'web'] as const
export type InboundCommandChannel = (typeof INBOUND_COMMAND_CHANNELS)[number]

export const INBOUND_COMMAND_STATUSES = [
  'received',
  'transcribing',
  'parsed',
  'needs_clarification',
  'applied',
  'rejected',
  'failed',
] as const
export type InboundCommandStatus = (typeof INBOUND_COMMAND_STATUSES)[number]

// ---------------------------------------------------------------------------
// Display labels
// ---------------------------------------------------------------------------

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  working: 'Working',
  follow_up_scheduled: 'Follow-up scheduled',
  waiting_on_customer: 'Waiting for customer',
  appointment_scheduled: 'Appointment scheduled',
  sold: 'Sold',
  lost: 'Lost',
  do_not_contact: 'Do not contact',
  archived: 'Archived',
}

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  phone_call: 'Phone call',
  sms: 'Text message',
  email: 'Email',
  whatsapp: 'WhatsApp',
  voicemail: 'Voicemail',
  in_person: 'In person',
  other: 'Other',
}

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  pending: 'Pending',
  snoozed: 'Snoozed',
  completed: 'Completed',
  canceled: 'Canceled',
  overdue: 'Overdue',
  waiting_on_customer: 'Waiting for customer',
}

export const LEAD_PRIORITY_LABELS: Record<LeadPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
}

export function isClosedLeadStatus(status: LeadStatus): boolean {
  return (CLOSED_LEAD_STATUSES as readonly string[]).includes(status)
}

export function isOpenFollowUpStatus(status: FollowUpStatus): boolean {
  return (OPEN_FOLLOW_UP_STATUSES as readonly string[]).includes(status)
}
