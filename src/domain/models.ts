import type {
  ActivityDirection,
  ActivityOutcome,
  ActivityType,
  ContactMethod,
  FollowUpStatus,
  InboundCommandChannel,
  InboundCommandStatus,
  LeadPriority,
  LeadStatus,
  LeadTemperature,
  NotificationKind,
  NotificationStatus,
  PreferredLanguage,
  RecordSource,
  ReminderStatus,
  ScreenshotStatus,
  VehicleCondition,
} from './vocabulary.ts'

/** Timestamps cross the wire as ISO 8601 strings. */
export type IsoTimestamp = string

export interface Customer {
  id: string
  userId: string
  fullName: string
  firstName: string | null
  lastName: string | null
  normalizedName: string | null
  primaryPhone: string | null
  normalizedPhone: string | null
  primaryEmail: string | null
  normalizedEmail: string | null
  dealershipCustomerId: string | null
  city: string | null
  state: string | null
  preferredLanguage: PreferredLanguage
  salesperson: string | null
  leadSource: string | null
  leadPriority: LeadPriority
  leadTemperature: LeadTemperature
  leadStatus: LeadStatus
  /** What the customer asked to be contacted by; a preference, not a record. */
  preferredContactMethod: ContactMethod | null
  notes: string | null
  /** Surfaced on the card and detail header without the rest of the notes. */
  pinnedNote: string | null
  objections: string | null
  tradeNotes: string | null
  financeStatus: string | null
  source: RecordSource
  lastActivityAt: IsoTimestamp | null
  archivedAt: IsoTimestamp | null
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

export interface CustomerContactMethod {
  id: string
  customerId: string
  method: ContactMethod
  value: string
  label: string | null
  isPrimary: boolean
  isVerified: boolean
  /** Channel-level opt-out. An opted-out method is never recommended. */
  optedOut: boolean
  source: RecordSource
}

export interface VehicleInterest {
  id: string
  customerId: string
  modelYear: number | null
  make: string | null
  model: string | null
  floorplan: string | null
  stockNumber: string | null
  condition: VehicleCondition
  isPrimary: boolean
  notes: string | null
}

export interface Activity {
  id: string
  customerId: string
  type: ActivityType
  direction: ActivityDirection
  method: ContactMethod | null
  outcome: ActivityOutcome | null
  summary: string | null
  /** Verbatim untrusted text: OCR output, a WhatsApp body, or a transcript. */
  rawText: string | null
  occurredAt: IsoTimestamp
  source: RecordSource
  /**
   * True only when I personally attempted this contact. Activity imported from
   * a CRM screenshot is false even when it describes an outbound call.
   */
  performedByUser: boolean
  externalMessageId: string | null
}

export interface FollowUp {
  id: string
  customerId: string
  dueAt: IsoTimestamp
  status: FollowUpStatus
  priority: LeadPriority
  reason: string | null
  recommendedMethod: ContactMethod | null
  waitingUntil: IsoTimestamp | null
  completedAt: IsoTimestamp | null
  snoozedUntil: IsoTimestamp | null
  reminderStatus: ReminderStatus
  whatsappMessageId: string | null
  /** An appointment is a follow-up with a stronger promise attached. */
  isAppointment: boolean
  canceledAt: IsoTimestamp | null
  /** How the previous commitment ended, kept so history is never silent. */
  outcomeNote: string | null
  /** Set when this follow-up replaced an earlier one, making the chain walkable. */
  rescheduledFromId: string | null
  createdAt: IsoTimestamp
}

export interface Screenshot {
  id: string
  customerId: string | null
  /** SHA-256 of the image bytes; the duplicate-detection key. */
  fileHash: string
  mimeType: string
  byteSize: number
  status: ScreenshotStatus
  extractionProvider: string | null
  /** Untrusted OCR output. Kept only while the capture is unresolved. */
  rawText: string | null
  capturedAt: IsoTimestamp | null
  createdAt: IsoTimestamp

  /** What the decision engine concluded, so an automatic import is explainable. */
  decision: ImportDecisionName | null
  decisionReason: string | null
  overallConfidence: number | null
  warnings: string[]
  containsMultipleCustomers: boolean
  imageWidth: number | null
  imageHeight: number | null
  originalFilename: string | null
  /** Images are discarded after extraction unless retention is switched on. */
  retained: boolean
  reviewResolvedAt: IsoTimestamp | null
  reviewAction: string | null
}

/** Mirrors the ImportDecision union without importing the engine into models. */
export type ImportDecisionName =
  | 'AUTO_CREATE'
  | 'AUTO_UPDATE'
  | 'SAVE_WITH_UNVERIFIED_FIELDS'
  | 'NEEDS_MATCH_REVIEW'
  | 'NEEDS_CONFLICT_REVIEW'
  | 'EXTRACTION_FAILED'
  | 'DUPLICATE_IGNORED'

export interface ScreenshotExtractionField {
  id: string
  screenshotId: string
  fieldKey: string
  fieldValue: string | null
  confidence: number | null
  accepted: boolean | null
  /** False when the value was read with low confidence but still worth keeping. */
  verified: boolean
  appliedAsUnverified: boolean
}

/**
 * A question the app asked over WhatsApp that is still waiting for an answer.
 * One open per user, always with an expiry, so a bare "1" is never ambiguous.
 */
export interface ClarificationSession {
  id: string
  kind: string
  prompt: string
  options: Array<{ label: string; value: string }>
  pendingPayload: Record<string, unknown>
  expiresAt: IsoTimestamp
  resolvedAt: IsoTimestamp | null
  resolution: string | null
  createdAt: IsoTimestamp
}

export const USAGE_EVENT_KINDS = [
  'ocr_job',
  'screenshot_retained',
  'message_sent',
  'message_received',
  'message_failed',
  'message_retry',
  'reminder_generated',
] as const
export type UsageEventKind = (typeof USAGE_EVENT_KINDS)[number]

/** One measured unit of anything that could eventually cost money. */
export interface UsageEvent {
  id: string
  kind: UsageEventKind
  quantity: number
  /** Zero for anything free, such as in-browser OCR. */
  estimatedCostUsd: number
  occurredAt: IsoTimestamp
}

export interface InboundCommand {
  id: string
  customerId: string | null
  channel: InboundCommandChannel
  status: InboundCommandStatus
  fromNumberE164: string | null
  isApprovedSender: boolean
  rawText: string | null
  transcript: string | null
  parsedIntent: string | null
  parseConfidence: number | null
  receivedAt: IsoTimestamp
}

export interface NotificationLogEntry {
  id: string
  customerId: string | null
  followUpId: string | null
  kind: NotificationKind
  status: NotificationStatus
  /** Unique per logical message; the thing that makes a resend impossible. */
  idempotencyKey: string
  reminderStage: ReminderStage | null
  payloadSummary: string | null
  billable: boolean
  attemptCount: number
  error: string | null
  /** True once retries are exhausted, so the failure stays visible. */
  permanentFailure: boolean
  nextAttemptAt: IsoTimestamp | null
  sentAt: IsoTimestamp | null
  createdAt: IsoTimestamp
}

export const REMINDER_STAGES = [
  'due_now',
  'overdue',
  'waiting_deadline',
  'appointment',
  'morning_digest',
  'end_of_day_digest',
] as const
export type ReminderStage = (typeof REMINDER_STAGES)[number]

export const REMINDER_STAGE_LABELS: Record<ReminderStage, string> = {
  due_now: 'Due now',
  overdue: 'Overdue',
  waiting_deadline: 'Waiting deadline',
  appointment: 'Appointment',
  morning_digest: 'Morning digest',
  end_of_day_digest: 'End-of-day digest',
}

export interface Profile {
  id: string
  displayName: string | null
  timeZone: string
  whatsappNumberE164: string | null
  whatsappEnabled: boolean
  monthlyMessageBudget: number
  aiExtractionEnabled: boolean
  voiceTranscriptionEnabled: boolean
  monthlyVoiceMinuteBudget: number
  retainScreenshots: boolean
  retainVoiceAudio: boolean

  /** Scheduling preferences; see src/domain/settings.ts for the defaults. */
  morningAt: string
  afternoonAt: string
  noAnswerFollowUpHours: number
  voicemailFollowUpHours: number
  textNoReplyFollowUpHours: number
  emailNoReplyFollowUpHours: number
  quoteSentFollowUpHours: number
  waitingTimeoutHours: number
  defaultLeadPriority: LeadPriority
  dateTimeDisplay: DateTimeDisplay

  autoImportEnabled: boolean
  autoFollowUpOnImport: boolean
  newLeadSameDayCutoffHour: number
  sameDayFollowUpDelayHours: number

  remindersEnabled: boolean
  individualRemindersEnabled: boolean
  digestOnly: boolean
  morningDigestEnabled: boolean
  endOfDayDigestEnabled: boolean
  endOfDayDigestAt: string
  appointmentReminderLeadHours: number
  overdueReminderIntervalHours: number
  reminderMaxAttempts: number

  annualCostThresholdUsd: number
}

export type DateTimeDisplay = 'relative' | 'absolute' | 'both'

/**
 * An append-only record of a change. Written when an activity is corrected, so
 * that fixing a mistyped call outcome leaves a trail rather than rewriting
 * history silently.
 */
export interface AuditEntry {
  id: string
  action: 'insert' | 'update' | 'delete' | 'access_denied' | 'auth'
  tableName: string
  recordId: string | null
  summary: string | null
  /** Holds `before`, `after` and an optional `reason`. */
  metadata: Record<string, unknown>
  createdAt: IsoTimestamp
}
