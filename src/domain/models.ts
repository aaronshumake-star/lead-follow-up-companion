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
  fileHash: string
  mimeType: string
  byteSize: number
  status: ScreenshotStatus
  extractionProvider: string | null
  rawText: string | null
  capturedAt: IsoTimestamp | null
  createdAt: IsoTimestamp
}

export interface ScreenshotExtractionField {
  id: string
  screenshotId: string
  fieldKey: string
  fieldValue: string | null
  confidence: number | null
  accepted: boolean | null
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
  kind: NotificationKind
  status: NotificationStatus
  idempotencyKey: string
  payloadSummary: string | null
  billable: boolean
  sentAt: IsoTimestamp | null
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
