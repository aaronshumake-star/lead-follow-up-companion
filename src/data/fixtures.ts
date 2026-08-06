/**
 * Fictional fixtures mirroring supabase/seed.sql.
 *
 * Used by demo mode, the unit tests and the Playwright smoke test, so the app
 * is explorable and testable before a Supabase project exists. Every name,
 * number and stock code is invented; phone numbers use the 555-01xx range
 * reserved for fiction.
 *
 * Two customers — Renata Okonkwo and Travis Lindqvist — are deliberately left
 * without a follow-up so the no-next-action queue always has something to show.
 */

import type {
  Activity,
  Customer,
  CustomerContactMethod,
  FollowUp,
  NotificationLogEntry,
  Profile,
  Screenshot,
  VehicleInterest,
} from '../domain/models.ts'
import type { AppUser } from '../features/auth/auth-context.ts'

export const DEMO_USER: AppUser = {
  id: '00000000-0000-4000-8000-000000000000',
  email: 'demo@example.com',
  displayName: 'Demo User',
}

const NOW = new Date()

function hoursFromNow(hours: number): string {
  return new Date(NOW.getTime() + hours * 3_600_000).toISOString()
}

function daysFromNow(days: number): string {
  return hoursFromNow(days * 24)
}

/** Tomorrow at 10:00 local time — the example follow-up from the brief. */
function tomorrowAtTen(): string {
  const date = new Date(NOW)
  date.setDate(date.getDate() + 1)
  date.setHours(10, 0, 0, 0)
  return date.toISOString()
}

function customer(
  overrides: Partial<Customer> & Pick<Customer, 'id' | 'fullName' | 'leadStatus'>,
): Customer {
  return {
    userId: DEMO_USER.id,
    firstName: null,
    lastName: null,
    normalizedName: null,
    primaryPhone: null,
    normalizedPhone: null,
    primaryEmail: null,
    normalizedEmail: null,
    dealershipCustomerId: null,
    city: null,
    state: 'TX',
    preferredLanguage: 'en',
    salesperson: 'Me',
    leadSource: null,
    leadPriority: 'normal',
    leadTemperature: 'unknown',
    notes: null,
    source: 'seed',
    lastActivityAt: null,
    archivedAt: null,
    createdAt: daysFromNow(-30),
    updatedAt: daysFromNow(-1),
    ...overrides,
  }
}

export const DEMO_CUSTOMERS: Customer[] = [
  customer({
    id: 'c-ayala',
    fullName: 'Jesus Ayala',
    firstName: 'Jesus',
    lastName: 'Ayala',
    primaryPhone: '+15550100114',
    primaryEmail: 'jesus.ayala@example.com',
    dealershipCustomerId: 'RV-100114',
    city: 'Abilene',
    preferredLanguage: 'es',
    leadSource: 'Website form',
    leadPriority: 'high',
    leadTemperature: 'hot',
    leadStatus: 'follow_up_scheduled',
    notes: 'Wants a bunkhouse travel trailer under 30 feet. Tows with a half-ton.',
    lastActivityAt: hoursFromNow(-3),
  }),
  customer({
    id: 'c-whitfield',
    fullName: 'Marcy Whitfield',
    firstName: 'Marcy',
    lastName: 'Whitfield',
    primaryPhone: '+15550100127',
    primaryEmail: 'm.whitfield@example.com',
    dealershipCustomerId: 'RV-100127',
    city: 'Lubbock',
    leadSource: 'Walk-in',
    leadTemperature: 'warm',
    leadStatus: 'waiting_on_customer',
    notes: 'Sent trade-in appraisal. Waiting on her to confirm payoff amount.',
    lastActivityAt: daysFromNow(-2),
  }),
  customer({
    id: 'c-kobayashi',
    fullName: 'Dwight Kobayashi',
    firstName: 'Dwight',
    lastName: 'Kobayashi',
    primaryPhone: '+15550100138',
    primaryEmail: 'dkobayashi@example.com',
    dealershipCustomerId: 'RV-100138',
    city: 'Midland',
    leadSource: 'RV show',
    leadPriority: 'urgent',
    leadTemperature: 'hot',
    leadStatus: 'appointment_scheduled',
    notes: 'Coming in Saturday with his wife to walk two fifth wheels.',
    lastActivityAt: hoursFromNow(-20),
  }),
  customer({
    id: 'c-okonkwo',
    fullName: 'Renata Okonkwo',
    firstName: 'Renata',
    lastName: 'Okonkwo',
    primaryPhone: '+15550100142',
    primaryEmail: 'renata.okonkwo@example.com',
    dealershipCustomerId: 'RV-100142',
    city: 'San Angelo',
    leadSource: 'Phone-up',
    leadPriority: 'high',
    leadTemperature: 'warm',
    leadStatus: 'working',
    notes: 'Asked about towing capacity for a Class C. Never got a straight answer back to her.',
    lastActivityAt: daysFromNow(-4),
  }),
  customer({
    id: 'c-lindqvist',
    fullName: 'Travis Lindqvist',
    firstName: 'Travis',
    lastName: 'Lindqvist',
    primaryPhone: '+15550100155',
    dealershipCustomerId: 'RV-100155',
    city: 'Sweetwater',
    preferredLanguage: 'unknown',
    leadSource: 'Internet lead',
    leadStatus: 'new',
    source: 'screenshot',
    notes: 'Imported from a CRM screenshot. Nothing attempted yet.',
    lastActivityAt: daysFromNow(-1),
    createdAt: daysFromNow(-1),
  }),
  customer({
    id: 'c-raghunathan',
    fullName: 'Priya Raghunathan',
    firstName: 'Priya',
    lastName: 'Raghunathan',
    primaryPhone: '+15550100163',
    primaryEmail: 'priya.r@example.com',
    dealershipCustomerId: 'RV-100163',
    city: 'Odessa',
    leadSource: 'Referral',
    leadPriority: 'high',
    leadTemperature: 'warm',
    leadStatus: 'follow_up_scheduled',
    notes: 'Comparing our toy hauler against a competitor two hours away.',
    lastActivityAt: daysFromNow(-6),
  }),
  customer({
    id: 'c-brummett',
    fullName: 'Hal Brummett',
    firstName: 'Hal',
    lastName: 'Brummett',
    primaryPhone: '+15550100171',
    primaryEmail: 'hal.brummett@example.com',
    dealershipCustomerId: 'RV-100171',
    city: 'Big Spring',
    leadSource: 'Repeat customer',
    leadTemperature: 'hot',
    leadStatus: 'sold',
    notes: 'Delivered. Reminded him about the 90-day service check.',
    lastActivityAt: daysFromNow(-8),
  }),
  customer({
    id: 'c-dagenais',
    fullName: 'Corinne Dagenais',
    firstName: 'Corinne',
    lastName: 'Dagenais',
    primaryEmail: 'c.dagenais@example.com',
    dealershipCustomerId: 'RV-100184',
    city: 'Snyder',
    leadSource: 'Website form',
    leadPriority: 'low',
    leadTemperature: 'cold',
    leadStatus: 'lost',
    notes: 'Bought used from a private seller. Asked to be kept in mind for next year.',
    lastActivityAt: daysFromNow(-18),
  }),
  customer({
    id: 'c-vandergriff',
    fullName: 'Otis Vandergriff',
    firstName: 'Otis',
    lastName: 'Vandergriff',
    primaryPhone: '+15550100196',
    dealershipCustomerId: 'RV-100196',
    city: 'Colorado City',
    leadSource: 'Cold list',
    leadPriority: 'low',
    leadTemperature: 'cold',
    leadStatus: 'do_not_contact',
    notes: 'Asked not to be contacted again. Honor this.',
    lastActivityAt: daysFromNow(-30),
  }),
  customer({
    id: 'c-mbeki',
    fullName: 'Suzanne Mbeki',
    firstName: 'Suzanne',
    lastName: 'Mbeki',
    primaryEmail: 'suzanne.mbeki@example.com',
    dealershipCustomerId: 'RV-100203',
    city: 'Brownwood',
    leadSource: 'Internet lead',
    leadPriority: 'low',
    leadTemperature: 'cold',
    leadStatus: 'archived',
    notes: 'Went quiet for three months. Archived to keep the active list honest.',
    lastActivityAt: daysFromNow(-95),
    archivedAt: daysFromNow(-7),
  }),
  customer({
    id: 'c-delacroix',
    fullName: 'Frankie Delacroix',
    firstName: 'Frankie',
    lastName: 'Delacroix',
    primaryPhone: '+15550100218',
    primaryEmail: 'frankie.d@example.com',
    dealershipCustomerId: 'RV-100218',
    city: 'Abilene',
    leadSource: 'Service department',
    leadTemperature: 'warm',
    leadStatus: 'follow_up_scheduled',
    notes: 'In for service, mentioned upgrading to a bigger fifth wheel next spring.',
    lastActivityAt: daysFromNow(-9),
  }),
]

function contactMethod(
  id: string,
  customerId: string,
  method: CustomerContactMethod['method'],
  value: string,
  overrides: Partial<CustomerContactMethod> = {},
): CustomerContactMethod {
  return {
    id,
    customerId,
    method,
    value,
    label: null,
    isPrimary: true,
    isVerified: false,
    optedOut: false,
    source: 'seed',
    ...overrides,
  }
}

export const DEMO_CONTACT_METHODS: CustomerContactMethod[] = [
  contactMethod('m-1', 'c-ayala', 'phone_call', '+15550100114', { isVerified: true }),
  contactMethod('m-2', 'c-ayala', 'sms', '+15550100114', { isVerified: true }),
  contactMethod('m-3', 'c-ayala', 'whatsapp', '+15550100114'),
  contactMethod('m-4', 'c-ayala', 'email', 'jesus.ayala@example.com'),
  contactMethod('m-5', 'c-whitfield', 'phone_call', '+15550100127', { isVerified: true }),
  contactMethod('m-6', 'c-whitfield', 'email', 'm.whitfield@example.com', { isVerified: true }),
  contactMethod('m-7', 'c-kobayashi', 'phone_call', '+15550100138', { isVerified: true }),
  contactMethod('m-8', 'c-kobayashi', 'sms', '+15550100138', { isVerified: true }),
  contactMethod('m-9', 'c-kobayashi', 'email', 'dkobayashi@example.com'),
  contactMethod('m-10', 'c-okonkwo', 'phone_call', '+15550100142', { isVerified: true }),
  contactMethod('m-11', 'c-okonkwo', 'sms', '+15550100142'),
  contactMethod('m-12', 'c-okonkwo', 'email', 'renata.okonkwo@example.com'),
  contactMethod('m-13', 'c-lindqvist', 'phone_call', '+15550100155'),
  contactMethod('m-14', 'c-lindqvist', 'sms', '+15550100155'),
  contactMethod('m-15', 'c-raghunathan', 'phone_call', '+15550100163', { isVerified: true }),
  contactMethod('m-16', 'c-raghunathan', 'email', 'priya.r@example.com', { isVerified: true }),
  contactMethod('m-17', 'c-raghunathan', 'sms', '+15550100163'),
  contactMethod('m-18', 'c-brummett', 'phone_call', '+15550100171', { isVerified: true }),
  contactMethod('m-19', 'c-dagenais', 'email', 'c.dagenais@example.com', { isVerified: true }),
  // Opted out: on file, but never recommended.
  contactMethod('m-20', 'c-vandergriff', 'phone_call', '+15550100196', {
    isVerified: true,
    optedOut: true,
  }),
  contactMethod('m-21', 'c-mbeki', 'email', 'suzanne.mbeki@example.com'),
  contactMethod('m-22', 'c-delacroix', 'phone_call', '+15550100218', { isVerified: true }),
  contactMethod('m-23', 'c-delacroix', 'sms', '+15550100218', { isVerified: true }),
]

function activity(
  id: string,
  customerId: string,
  overrides: Partial<Activity> & Pick<Activity, 'type' | 'direction' | 'occurredAt'>,
): Activity {
  return {
    id,
    customerId,
    method: null,
    outcome: null,
    summary: null,
    rawText: null,
    source: 'manual',
    performedByUser: false,
    externalMessageId: null,
    ...overrides,
  }
}

export const DEMO_ACTIVITIES: Activity[] = [
  activity('a-1', 'c-ayala', {
    type: 'outbound_call',
    direction: 'outbound',
    method: 'phone_call',
    outcome: 'no_answer',
    summary: 'Called about the 28BHS. No answer, no voicemail box set up.',
    occurredAt: hoursFromNow(-3),
    performedByUser: true,
  }),
  activity('a-2', 'c-ayala', {
    type: 'outbound_text',
    direction: 'outbound',
    method: 'sms',
    outcome: 'no_reply',
    summary: 'Texted a photo of the outdoor kitchen.',
    occurredAt: daysFromNow(-2),
    performedByUser: true,
  }),
  activity('a-3', 'c-ayala', {
    type: 'inbound_call',
    direction: 'inbound',
    method: 'phone_call',
    outcome: 'connected',
    summary: 'He called in asking about payment on the 2022 unit.',
    occurredAt: daysFromNow(-4),
  }),
  activity('a-4', 'c-whitfield', {
    type: 'outbound_email',
    direction: 'outbound',
    method: 'email',
    outcome: 'no_reply',
    summary: 'Emailed the trade appraisal worksheet.',
    occurredAt: daysFromNow(-2),
    performedByUser: true,
  }),
  activity('a-5', 'c-whitfield', {
    type: 'outbound_call',
    direction: 'outbound',
    method: 'phone_call',
    outcome: 'left_voicemail',
    summary: 'Left voicemail asking for the payoff amount.',
    occurredAt: daysFromNow(-3),
    performedByUser: true,
  }),
  activity('a-6', 'c-kobayashi', {
    type: 'appointment',
    direction: 'outbound',
    method: 'in_person',
    outcome: 'appointment_set',
    summary: 'Saturday 10:00 walkthrough booked for two fifth wheels.',
    occurredAt: hoursFromNow(-20),
    performedByUser: true,
  }),
  activity('a-7', 'c-kobayashi', {
    type: 'outbound_text',
    direction: 'outbound',
    method: 'sms',
    outcome: 'replied',
    summary: 'Confirmed the appointment time by text.',
    occurredAt: hoursFromNow(-22),
    performedByUser: true,
  }),
  activity('a-8', 'c-okonkwo', {
    type: 'outbound_call',
    direction: 'outbound',
    method: 'phone_call',
    outcome: 'connected',
    summary: 'Talked through Class C towing limits, promised to send the spec sheet. Never sent it.',
    occurredAt: daysFromNow(-4),
    performedByUser: true,
  }),
  // Visible in the CRM but not something I did: performedByUser stays false.
  activity('a-9', 'c-okonkwo', {
    type: 'outbound_email',
    direction: 'outbound',
    method: 'email',
    outcome: 'no_reply',
    summary: 'CRM shows an automated brochure email went out.',
    occurredAt: daysFromNow(-10),
    source: 'screenshot',
  }),
  activity('a-10', 'c-lindqvist', {
    type: 'screenshot_import',
    direction: 'internal',
    summary: 'Created from a CRM screenshot. No contact attempted yet.',
    occurredAt: daysFromNow(-1),
    source: 'screenshot',
  }),
  activity('a-11', 'c-lindqvist', {
    type: 'outbound_text',
    direction: 'outbound',
    method: 'sms',
    outcome: 'no_reply',
    summary: 'CRM screenshot shows an auto-responder text from the internet lead tool.',
    occurredAt: daysFromNow(-1),
    source: 'screenshot',
  }),
  activity('a-12', 'c-raghunathan', {
    type: 'outbound_call',
    direction: 'outbound',
    method: 'phone_call',
    outcome: 'connected',
    summary: 'Went over the Havoc 3616 against the competitor quote.',
    occurredAt: daysFromNow(-6),
    performedByUser: true,
  }),
  activity('a-13', 'c-raghunathan', {
    type: 'inbound_email',
    direction: 'inbound',
    method: 'email',
    outcome: 'replied',
    summary: 'She sent over the competitor quote as a PDF.',
    occurredAt: daysFromNow(-5),
  }),
  activity('a-14', 'c-brummett', {
    type: 'in_person',
    direction: 'outbound',
    method: 'in_person',
    outcome: 'sold',
    summary: 'Signed and delivered the 29BH.',
    occurredAt: daysFromNow(-8),
    performedByUser: true,
  }),
  activity('a-15', 'c-dagenais', {
    type: 'outbound_call',
    direction: 'outbound',
    method: 'phone_call',
    outcome: 'not_interested',
    summary: 'She bought private party. Asked to check back next season.',
    occurredAt: daysFromNow(-18),
    performedByUser: true,
  }),
  activity('a-16', 'c-vandergriff', {
    type: 'inbound_call',
    direction: 'inbound',
    method: 'phone_call',
    outcome: 'not_interested',
    summary: 'Asked to be removed from all contact.',
    occurredAt: daysFromNow(-30),
  }),
  activity('a-17', 'c-delacroix', {
    type: 'in_person',
    direction: 'outbound',
    method: 'in_person',
    outcome: 'connected',
    summary: 'Chatted in the service lane about upgrading next spring.',
    occurredAt: daysFromNow(-9),
    performedByUser: true,
  }),
]

function followUp(
  id: string,
  customerId: string,
  overrides: Partial<FollowUp> & Pick<FollowUp, 'dueAt' | 'status'>,
): FollowUp {
  return {
    id,
    customerId,
    priority: 'normal',
    reason: null,
    recommendedMethod: null,
    waitingUntil: null,
    completedAt: null,
    snoozedUntil: null,
    reminderStatus: 'not_scheduled',
    whatsappMessageId: null,
    ...overrides,
  }
}

export const DEMO_FOLLOW_UPS: FollowUp[] = [
  followUp('f-1', 'c-ayala', {
    dueAt: tomorrowAtTen(),
    status: 'pending',
    priority: 'high',
    reason: 'Retry the call about the 28BHS after no answer.',
    recommendedMethod: 'phone_call',
    reminderStatus: 'scheduled',
  }),
  followUp('f-2', 'c-whitfield', {
    dueAt: daysFromNow(4),
    status: 'waiting_on_customer',
    reason: 'Waiting on her payoff amount before the trade number is real.',
    recommendedMethod: 'email',
    waitingUntil: daysFromNow(4),
  }),
  followUp('f-3', 'c-kobayashi', {
    dueAt: daysFromNow(2),
    status: 'pending',
    priority: 'urgent',
    reason: 'Confirm Saturday walkthrough the day before.',
    recommendedMethod: 'sms',
    reminderStatus: 'scheduled',
  }),
  // Overdue: exactly the failure this app exists to catch.
  followUp('f-4', 'c-raghunathan', {
    dueAt: daysFromNow(-2),
    status: 'overdue',
    priority: 'high',
    reason: 'Promised a written response to the competitor quote.',
    recommendedMethod: 'email',
    reminderStatus: 'sent',
  }),
  followUp('f-5', 'c-delacroix', {
    dueAt: daysFromNow(21),
    status: 'snoozed',
    priority: 'low',
    reason: 'Check back when next model year inventory arrives.',
    recommendedMethod: 'phone_call',
    snoozedUntil: daysFromNow(21),
  }),
  followUp('f-6', 'c-brummett', {
    dueAt: daysFromNow(-8),
    status: 'completed',
    reason: 'Delivery paperwork follow-up.',
    recommendedMethod: 'phone_call',
    completedAt: daysFromNow(-8),
    reminderStatus: 'sent',
  }),
]

export const DEMO_VEHICLE_INTERESTS: VehicleInterest[] = [
  {
    id: 'v-1',
    customerId: 'c-ayala',
    modelYear: 2024,
    make: 'Cedar Ridge',
    model: 'Trailblazer',
    floorplan: '28BHS',
    stockNumber: 'STK-48211',
    condition: 'new',
    isPrimary: true,
    notes: 'Bunkhouse, wants the outdoor kitchen option.',
  },
  {
    id: 'v-2',
    customerId: 'c-kobayashi',
    modelYear: 2025,
    make: 'Ironwood',
    model: 'Summit',
    floorplan: '38FL',
    stockNumber: 'STK-48590',
    condition: 'new',
    isPrimary: true,
    notes: 'Front living fifth wheel, needs a dually to tow.',
  },
  {
    id: 'v-3',
    customerId: 'c-okonkwo',
    modelYear: 2024,
    make: 'Harborview',
    model: 'Voyager',
    floorplan: 'C24',
    stockNumber: 'STK-48332',
    condition: 'new',
    isPrimary: true,
    notes: 'Class C, asked specifically about towing a small SUV.',
  },
  {
    id: 'v-4',
    customerId: 'c-raghunathan',
    modelYear: 2024,
    make: 'Ironwood',
    model: 'Havoc',
    floorplan: '3616',
    stockNumber: 'STK-48477',
    condition: 'new',
    isPrimary: true,
    notes: 'Toy hauler for two side-by-sides.',
  },
]

export const DEMO_SCREENSHOTS: Screenshot[] = [
  {
    id: 's-1',
    customerId: null,
    fileHash: 'b2'.repeat(32),
    mimeType: 'image/png',
    byteSize: 210_044,
    status: 'needs_review',
    extractionProvider: 'seed',
    rawText:
      'Customer: Renata Okonkwo\nID: RV-100142\nPhone: (555) 010-0142\nStatus: Working\nLast contact: 4 days ago',
    capturedAt: hoursFromNow(-2),
    createdAt: hoursFromNow(-2),
  },
  {
    id: 's-2',
    customerId: 'c-lindqvist',
    fileHash: 'a1'.repeat(32),
    mimeType: 'image/png',
    byteSize: 184_320,
    status: 'applied',
    extractionProvider: 'seed',
    rawText:
      'Customer: Travis Lindqvist\nID: RV-100155\nPhone: (555) 010-0155\nCity: Sweetwater, TX\nSource: Internet lead',
    capturedAt: daysFromNow(-1),
    createdAt: daysFromNow(-1),
  },
]

export const DEMO_NOTIFICATIONS: NotificationLogEntry[] = [
  {
    id: 'n-1',
    customerId: null,
    kind: 'morning_summary',
    status: 'delivered',
    idempotencyKey: 'seed:morning_summary',
    payloadSummary: '3 due today, 1 overdue, 2 with no next action',
    billable: true,
    sentAt: hoursFromNow(-9),
  },
  {
    id: 'n-2',
    customerId: 'c-ayala',
    kind: 'follow_up_reminder',
    status: 'delivered',
    idempotencyKey: 'seed:follow_up_reminder:ayala',
    payloadSummary: '1 follow-up due: Jesus Ayala 10:00',
    billable: true,
    sentAt: hoursFromNow(-5),
  },
  {
    id: 'n-3',
    customerId: 'c-ayala',
    kind: 'command_confirmation',
    status: 'sent',
    idempotencyKey: 'seed:command_confirmation',
    payloadSummary: 'Logged call, follow-up set for tomorrow 10:00',
    billable: false,
    sentAt: hoursFromNow(-3),
  },
]

export const DEMO_PROFILE: Profile = {
  id: DEMO_USER.id,
  displayName: 'Demo User',
  timeZone: 'America/Chicago',
  whatsappNumberE164: null,
  whatsappEnabled: false,
  monthlyMessageBudget: 300,
  aiExtractionEnabled: false,
  voiceTranscriptionEnabled: false,
  monthlyVoiceMinuteBudget: 30,
  retainScreenshots: false,
  retainVoiceAudio: false,
}

export function activitiesForCustomer(customerId: string): Activity[] {
  return DEMO_ACTIVITIES.filter((item) => item.customerId === customerId)
}

export function contactMethodsForCustomer(customerId: string): CustomerContactMethod[] {
  return DEMO_CONTACT_METHODS.filter((item) => item.customerId === customerId)
}

export function followUpsForCustomer(customerId: string): FollowUp[] {
  return DEMO_FOLLOW_UPS.filter((item) => item.customerId === customerId)
}
