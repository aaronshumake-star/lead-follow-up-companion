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
  notes: string | null
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
}
