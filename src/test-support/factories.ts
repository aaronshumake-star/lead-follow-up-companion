/**
 * Object factories for tests.
 *
 * Every factory fills in a complete, valid record so a test only has to state
 * the fields it actually cares about. Keeping them here means adding a column
 * to a model is a one-line change rather than an edit to every test file.
 */

import type {
  Activity,
  Customer,
  CustomerContactMethod,
  FollowUp,
  Profile,
  VehicleInterest,
} from '../domain/models.ts'
import type {
  ActivityDirection,
  ActivityType,
  ContactMethod,
  FollowUpStatus,
  LeadStatus,
} from '../domain/vocabulary.ts'
import { DEFAULT_SETTINGS } from '../domain/settings.ts'

const DEFAULT_NOW = '2026-08-05T15:00:00.000Z'
export const TEST_USER_ID = 'user-1'

export function makeCustomer(
  overrides: Partial<Customer> & { id?: string; leadStatus?: LeadStatus } = {},
): Customer {
  const leadStatus = overrides.leadStatus ?? 'working'

  return {
    id: 'cust-1',
    userId: TEST_USER_ID,
    fullName: 'Test Customer',
    firstName: null,
    lastName: null,
    normalizedName: 'test customer',
    primaryPhone: null,
    normalizedPhone: null,
    primaryEmail: null,
    normalizedEmail: null,
    dealershipCustomerId: null,
    city: null,
    state: null,
    preferredLanguage: 'unknown',
    salesperson: null,
    leadSource: null,
    leadPriority: 'normal',
    leadTemperature: 'unknown',
    leadStatus,
    preferredContactMethod: null,
    notes: null,
    pinnedNote: null,
    objections: null,
    tradeNotes: null,
    financeStatus: null,
    source: 'manual',
    lastActivityAt: null,
    // The archived status and the timestamp must agree, matching the
    // customers_archived_consistency check constraint.
    archivedAt: leadStatus === 'archived' ? DEFAULT_NOW : null,
    createdAt: DEFAULT_NOW,
    updatedAt: DEFAULT_NOW,
    ...overrides,
  }
}

export function makeFollowUp(
  overrides: Partial<FollowUp> & { status?: FollowUpStatus; dueAt?: string } = {},
): FollowUp {
  const status = overrides.status ?? 'pending'
  const dueAt = overrides.dueAt ?? DEFAULT_NOW

  return {
    id: `fu-${status}-${dueAt}`,
    customerId: 'cust-1',
    dueAt,
    status,
    priority: 'normal',
    reason: null,
    recommendedMethod: null,
    waitingUntil: null,
    completedAt: status === 'completed' ? dueAt : null,
    snoozedUntil: null,
    reminderStatus: 'not_scheduled',
    whatsappMessageId: null,
    isAppointment: false,
    canceledAt: status === 'canceled' ? dueAt : null,
    outcomeNote: null,
    rescheduledFromId: null,
    createdAt: DEFAULT_NOW,
    ...overrides,
  }
}

export function makeActivity(
  overrides: Partial<Activity> & {
    type?: ActivityType
    direction?: ActivityDirection
    occurredAt?: string
  } = {},
): Activity {
  return {
    id: 'act-1',
    customerId: 'cust-1',
    type: 'outbound_call',
    direction: 'outbound',
    method: null,
    outcome: null,
    summary: null,
    rawText: null,
    occurredAt: DEFAULT_NOW,
    source: 'manual',
    // Never defaulted to true: an activity is only a personal attempt when the
    // caller says so explicitly.
    performedByUser: false,
    externalMessageId: null,
    ...overrides,
  }
}

export function makeContactMethod(
  overrides: Partial<CustomerContactMethod> & { method?: ContactMethod } = {},
): CustomerContactMethod {
  return {
    id: 'cm-1',
    customerId: 'cust-1',
    method: 'phone_call',
    value: '+15550100301',
    label: null,
    isPrimary: false,
    isVerified: false,
    optedOut: false,
    source: 'manual',
    ...overrides,
  }
}

export function makeVehicleInterest(overrides: Partial<VehicleInterest> = {}): VehicleInterest {
  return {
    id: 'veh-1',
    customerId: 'cust-1',
    modelYear: 2026,
    make: 'Cedar Ridge',
    model: 'Trailblazer',
    floorplan: '28BHS',
    stockNumber: 'STK-00001',
    condition: 'new',
    isPrimary: true,
    notes: null,
    ...overrides,
  }
}

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: TEST_USER_ID,
    displayName: 'Test User',
    whatsappNumberE164: null,
    whatsappEnabled: false,
    monthlyMessageBudget: 300,
    aiExtractionEnabled: false,
    voiceTranscriptionEnabled: false,
    monthlyVoiceMinuteBudget: 30,
    retainScreenshots: false,
    retainVoiceAudio: false,
    ...DEFAULT_SETTINGS,
    ...overrides,
  }
}
