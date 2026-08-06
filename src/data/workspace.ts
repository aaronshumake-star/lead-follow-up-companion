/**
 * The working set and the operations that change it.
 *
 * Both storage backends — browser-local demo data and Supabase — implement the
 * same `Repository` interface and return the same `WorkspaceSnapshot`, so every
 * page, queue and rule runs identical code in both modes. That is what makes
 * demo mode a faithful rehearsal rather than a separate app.
 *
 * The snapshot is loaded whole and refreshed after each mutation. For a
 * single-user tool with a few hundred customers this is far simpler than
 * per-view queries and keeps all the derivation in the tested domain layer.
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
} from '../domain/models.ts'
import type { ExtractionResult } from '../domain/screenshot/extraction.ts'
import type { ImportDecision } from '../domain/screenshot/decision-engine.ts'
import type { MatchCandidate } from '../domain/screenshot/matching.ts'
import type { ReminderStage, UsageEventKind } from '../domain/models.ts'
import type {
  ActivityDirection,
  ActivityOutcome,
  ActivityType,
  ContactMethod,
  LeadPriority,
  LeadStatus,
  LeadTemperature,
  PreferredLanguage,
  RecordSource,
  VehicleCondition,
} from '../domain/vocabulary.ts'
import type { UserSettings } from '../domain/settings.ts'

export interface WorkspaceSnapshot {
  profile: Profile
  customers: Customer[]
  contactMethods: CustomerContactMethod[]
  vehicleInterests: VehicleInterest[]
  activities: Activity[]
  followUps: FollowUp[]
  /** Recent audit entries, used to mark corrected activities in the timeline. */
  auditEntries: AuditEntry[]
  screenshots: Screenshot[]
  extractionFields: ScreenshotExtractionField[]
  matchCandidates: StoredMatchCandidate[]
  notifications: NotificationLogEntry[]
  clarificationSessions: ClarificationSession[]
  usageEvents: UsageEvent[]
  voiceRecords: VoiceProcessingRecord[]
}

export interface StoredMatchCandidate {
  id: string
  screenshotId: string
  customerId: string
  score: number
  reasons: string[]
  conflicts: Array<{ field: string; existing: string; incoming: string }>
  selected: boolean
}

export type StorageMode = 'demo' | 'supabase'

// ---------------------------------------------------------------------------
// Customer input
// ---------------------------------------------------------------------------

export interface CustomerDraft {
  fullName: string
  firstName?: string | null
  lastName?: string | null
  primaryPhone?: string | null
  primaryEmail?: string | null
  dealershipCustomerId?: string | null
  city?: string | null
  state?: string | null
  preferredLanguage?: PreferredLanguage
  preferredContactMethod?: ContactMethod | null
  salesperson?: string | null
  leadSource?: string | null
  leadPriority?: LeadPriority
  leadTemperature?: LeadTemperature
  leadStatus?: LeadStatus
  notes?: string | null
  pinnedNote?: string | null
  objections?: string | null
  tradeNotes?: string | null
  financeStatus?: string | null
}

export type CustomerPatch = Partial<CustomerDraft>

export interface ContactMethodDraft {
  method: ContactMethod
  value: string
  label?: string | null
  isPrimary?: boolean
  isVerified?: boolean
  optedOut?: boolean
}

export interface VehicleInterestDraft {
  modelYear?: number | null
  make?: string | null
  model?: string | null
  floorplan?: string | null
  stockNumber?: string | null
  condition?: VehicleCondition
  isPrimary?: boolean
  notes?: string | null
}

// ---------------------------------------------------------------------------
// Activity input
// ---------------------------------------------------------------------------

export interface ActivityDraft {
  customerId: string
  type: ActivityType
  direction: ActivityDirection
  method?: ContactMethod | null
  outcome?: ActivityOutcome | null
  summary?: string | null
  occurredAt?: string
  source?: RecordSource
  /**
   * Whether *I* made this contact. Defaults are never inferred: a caller has to
   * say so, which is what keeps screenshot-visible activity out of the
   * attempted-by-me accounting.
   */
  performedByUser: boolean
}

export interface ActivityPatch {
  type?: ActivityType
  direction?: ActivityDirection
  method?: ContactMethod | null
  outcome?: ActivityOutcome | null
  summary?: string | null
  occurredAt?: string
  performedByUser?: boolean
}

// ---------------------------------------------------------------------------
// Follow-up input
// ---------------------------------------------------------------------------

/** What happens to the follow-up currently open when a new one is created. */
export type FollowUpResolution = 'complete' | 'cancel' | 'reschedule'

/**
 * What to do about the next action after recording an activity. Mirrors the six
 * choices the brief asks for, plus the no-op.
 */
export type FollowUpPlan =
  | { kind: 'none' }
  /** Close the open follow-up and schedule nothing. */
  | { kind: 'complete'; note?: string | null }
  | {
      kind: 'schedule'
      dueAt: string
      reason?: string | null
      recommendedMethod?: ContactMethod | null
      priority?: LeadPriority
      isAppointment?: boolean
      /** How the previous commitment is recorded; never silently dropped. */
      resolution: FollowUpResolution
      resolutionNote?: string | null
    }
  | {
      kind: 'waiting'
      waitingUntil: string
      reason?: string | null
      resolution: FollowUpResolution
      resolutionNote?: string | null
    }
  /** Close the customer out entirely: sold, lost, do not contact, archived. */
  | { kind: 'close'; leadStatus: LeadStatus; note?: string | null }

export interface ScheduleFollowUpInput {
  customerId: string
  dueAt: string
  reason?: string | null
  recommendedMethod?: ContactMethod | null
  priority?: LeadPriority
  waitingUntil?: string | null
  isAppointment?: boolean
  resolution?: FollowUpResolution
  resolutionNote?: string | null
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface Repository {
  readonly mode: StorageMode

  load(): Promise<WorkspaceSnapshot>

  createCustomer(draft: CustomerDraft): Promise<string>
  updateCustomer(customerId: string, patch: CustomerPatch): Promise<void>
  /** Records a status change as an activity as well, so the timeline shows it. */
  setLeadStatus(customerId: string, status: LeadStatus, note?: string | null): Promise<void>
  archiveCustomer(customerId: string): Promise<void>
  restoreCustomer(customerId: string, status: LeadStatus): Promise<void>
  deleteCustomer(customerId: string): Promise<void>

  addContactMethod(customerId: string, draft: ContactMethodDraft): Promise<void>
  updateContactMethod(contactMethodId: string, patch: Partial<ContactMethodDraft>): Promise<void>
  removeContactMethod(contactMethodId: string): Promise<void>

  saveVehicleInterest(
    customerId: string,
    draft: VehicleInterestDraft,
    vehicleInterestId?: string,
  ): Promise<void>
  removeVehicleInterest(vehicleInterestId: string): Promise<void>

  /** Records an activity and applies the chosen next-action plan. */
  logActivity(draft: ActivityDraft, plan?: FollowUpPlan): Promise<void>
  /** Corrects an activity, writing a before/after audit entry. */
  updateActivity(activityId: string, patch: ActivityPatch, reason?: string | null): Promise<void>

  scheduleFollowUp(input: ScheduleFollowUpInput): Promise<void>
  completeFollowUp(customerId: string, note?: string | null): Promise<void>
  cancelFollowUp(customerId: string, note?: string | null): Promise<void>
  snoozeFollowUp(followUpId: string, snoozedUntil: string): Promise<void>

  /** Returns lapsed waiting deadlines to the action queue. Idempotent. */
  expireWaitingFollowUps(now?: Date): Promise<number>

  updateSettings(patch: Partial<UserSettings>): Promise<void>
  updateProfile(patch: Partial<Pick<Profile, 'displayName'>>): Promise<void>

  // -------------------------------------------------------------------------
  // Screenshot intake
  // -------------------------------------------------------------------------

  /** True when this exact image has already been processed. */
  findScreenshotByHash(fileHash: string): Promise<{ id: string; decision: ImportDecision | null } | null>
  /**
   * Records the capture, applies the decision, and returns what changed.
   * One call so a decision can never be recorded without its writes.
   */
  applyScreenshotImport(input: ApplyImportInput): Promise<ImportOutcome>
  /** Resolves a screenshot sitting in the review queue. */
  resolveScreenshotReview(input: ResolveReviewInput): Promise<ImportOutcome>
  discardScreenshot(screenshotId: string, reason?: string | null): Promise<void>

  // -------------------------------------------------------------------------
  // Messaging and cost
  // -------------------------------------------------------------------------

  recordUsage(kind: UsageEventKind, quantity?: number, estimatedCostUsd?: number): Promise<void>

  /**
   * Demo mode only: drives the simulated reminder and inbound-command surfaces
   * on the WhatsApp page. Absent against Supabase, where the worker owns both.
   */
  simulateReminderRun?(now?: Date): Promise<SimulatedDispatch>
  simulateInboundMessage?(fromE164: string, text: string, now?: Date): Promise<SimulatedInbound>
  simulateVoiceMessage?(scenarioId: string, fromE164: string, now?: Date): Promise<SimulatedVoice>
  retryVoiceMessage?(voiceRecordId: string): Promise<SimulatedVoice>
  deleteRetainedAudio?(voiceRecordId: string): Promise<void>
  cleanupPrivateData?(before: Date): Promise<number>
  deleteAllUserData?(): Promise<void>

  /** Demo mode only: discards local records and reloads the fixtures. */
  resetDemoData?(): Promise<void>
}

// ---------------------------------------------------------------------------
// Screenshot import
// ---------------------------------------------------------------------------

export interface ScreenshotIntakeMetadata {
  fileHash: string
  mimeType: string
  byteSize: number
  imageWidth: number | null
  imageHeight: number | null
  /** Already sanitised; never used to build a filesystem path. */
  originalFilename: string | null
  capturedAt?: string | null
}

export interface ApplyImportInput {
  screenshot: ScreenshotIntakeMetadata
  /** Untrusted OCR text, kept only while the capture is unresolved. */
  rawText: string | null
  extractionProvider: string
  extraction: ExtractionResult | null
  decision: ImportDecision
  decisionReason: string
  /** For AUTO_UPDATE and SAVE_WITH_UNVERIFIED_FIELDS. */
  targetCustomerId: string | null
  candidates: readonly MatchCandidate[]
  unverifiedFields: readonly string[]
  warnings: readonly string[]
  /** Retention is opt-in; otherwise only the hash and text survive. */
  retainImage: boolean
  now?: Date
}

export interface ImportChange {
  /** Short, human-readable line for the compact import summary. */
  label: string
  detail?: string
}

export interface ImportOutcome {
  screenshotId: string
  decision: ImportDecision
  reason: string
  customerId: string | null
  customerName: string | null
  changes: ImportChange[]
  /** Set when a follow-up was created, so the summary can name the time. */
  followUpDueAt: string | null
  requiresReview: boolean
  /** True when the import can be rolled back safely. */
  undoable: boolean
}

export type ReviewAction =
  | { kind: 'create_new' }
  | { kind: 'select_existing'; customerId: string }
  /** Applies the extraction but marks the uncertain fields unverified. */
  | { kind: 'select_existing_unverified'; customerId: string }
  | { kind: 'keep_existing_fields'; customerId: string }
  | { kind: 'discard' }

export interface ResolveReviewInput {
  screenshotId: string
  action: ReviewAction
  /** Field keys the operator chose to drop before applying. */
  ignoredFields?: readonly string[]
  /** Corrections typed over the OCR result before applying. */
  corrections?: Partial<{
    fullName: string | null
    phone: string | null
    email: string | null
    customerId: string | null
    city: string | null
    state: string | null
  }>
  now?: Date
}

// ---------------------------------------------------------------------------
// Demo simulation
// ---------------------------------------------------------------------------

export interface SimulatedDispatch {
  /** Messages actually sent on this run. */
  sent: Array<{ stage: ReminderStage; body: string; idempotencyKey: string }>
  /** Messages skipped because an identical one had already been claimed. */
  suppressed: Array<{ stage: ReminderStage; idempotencyKey: string; reason: string }>
  expiredWaiting: number
}

export interface SimulatedInbound {
  accepted: boolean
  /** The reply the app would send back. Empty when the sender was rejected. */
  reply: string
  /** Present when the sender was not the approved number. */
  rejectionReason?: string
}

export interface SimulatedVoice {
  accepted: boolean
  reply: string
  voiceRecordId: string | null
  customerId?: string | null
  rejectionReason?: string
}
