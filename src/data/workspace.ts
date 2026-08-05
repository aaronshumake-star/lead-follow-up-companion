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
  Customer,
  CustomerContactMethod,
  FollowUp,
  Profile,
  VehicleInterest,
} from '../domain/models.ts'
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

  /** Demo mode only: discards local records and reloads the fixtures. */
  resetDemoData?(): Promise<void>
}
