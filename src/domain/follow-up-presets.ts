/**
 * The follow-up engine's scheduling vocabulary.
 *
 * Two jobs:
 *   1. Turn a preset such as "tomorrow morning" into an absolute instant in the
 *      operator's time zone.
 *   2. Suggest a sensible default after an activity, so the common case is one
 *      click rather than a date picker.
 *
 * Suggestions are defaults, never decisions — every one is editable before it
 * is saved, and every interval comes from user settings rather than being
 * hard-coded here.
 */

import type { UserSettings } from './settings.ts'
import { atZonedTime } from '../lib/time-zone.ts'
import type { ActivityOutcome, ActivityType, ContactMethod } from './vocabulary.ts'

export const FOLLOW_UP_PRESETS = [
  'later_today',
  'tomorrow_morning',
  'tomorrow_afternoon',
  'in_two_days',
  'in_three_days',
  'next_week',
  'custom',
  'waiting_for_customer',
  'appointment',
  'no_further_action',
] as const
export type FollowUpPreset = (typeof FOLLOW_UP_PRESETS)[number]

export const FOLLOW_UP_PRESET_LABELS: Record<FollowUpPreset, string> = {
  later_today: 'Later today',
  tomorrow_morning: 'Tomorrow morning',
  tomorrow_afternoon: 'Tomorrow afternoon',
  in_two_days: 'In two days',
  in_three_days: 'In three days',
  next_week: 'Next week',
  custom: 'Custom date and time',
  waiting_for_customer: 'Waiting for customer',
  appointment: 'Appointment',
  no_further_action: 'No further action',
}

/** Presets that produce a time on their own, without a custom date picker. */
export const SCHEDULING_PRESETS: readonly FollowUpPreset[] = [
  'later_today',
  'tomorrow_morning',
  'tomorrow_afternoon',
  'in_two_days',
  'in_three_days',
  'next_week',
]

/** How many hours ahead "later today" means before it rolls into tomorrow. */
const LATER_TODAY_HOURS = 3

/**
 * Resolves a preset to an absolute instant.
 *
 * Returns null for presets that carry no time of their own — 'custom' takes a
 * date from the operator, and 'no_further_action' schedules nothing at all.
 */
export function resolvePreset(
  preset: FollowUpPreset,
  settings: UserSettings,
  now: Date = new Date(),
): Date | null {
  const zone = settings.timeZone

  switch (preset) {
    case 'later_today':
      // Deliberately relative rather than a fixed hour: "later" at 8am and
      // "later" at 4pm should not resolve to the same moment.
      return new Date(now.getTime() + LATER_TODAY_HOURS * 3_600_000)
    case 'tomorrow_morning':
      return atZonedTime(now, zone, 1, settings.morningAt)
    case 'tomorrow_afternoon':
      return atZonedTime(now, zone, 1, settings.afternoonAt)
    case 'in_two_days':
      return atZonedTime(now, zone, 2, settings.morningAt)
    case 'in_three_days':
      return atZonedTime(now, zone, 3, settings.morningAt)
    case 'next_week':
      return atZonedTime(now, zone, 7, settings.morningAt)
    case 'waiting_for_customer':
      return new Date(now.getTime() + settings.waitingTimeoutHours * 3_600_000)
    case 'appointment':
    case 'custom':
    case 'no_further_action':
      return null
  }
}

export interface FollowUpSuggestion {
  preset: FollowUpPreset
  dueAt: Date
  reason: string
  recommendedMethod: ContactMethod | null
  /** True when the suggestion is a waiting deadline rather than a task. */
  isWaiting: boolean
}

/**
 * The default follow-up for an activity outcome.
 *
 * Intervals come from settings, so someone who works a faster cadence changes
 * them once rather than arguing with the app on every call.
 */
export function suggestFollowUp(
  activityType: ActivityType,
  outcome: ActivityOutcome | null,
  settings: UserSettings,
  now: Date = new Date(),
): FollowUpSuggestion | null {
  const inHours = (hours: number): Date => new Date(now.getTime() + hours * 3_600_000)

  // An appointment being set is its own next action, so no chasing follow-up.
  if (outcome === 'appointment_set' || activityType === 'appointment') {
    return {
      preset: 'appointment',
      dueAt: inHours(24),
      reason: 'Confirm the appointment beforehand',
      recommendedMethod: 'sms',
      isWaiting: false,
    }
  }

  // A closed outcome ends the obligation; the status change covers it.
  if (outcome === 'sold' || outcome === 'not_interested') return null

  if (activityType === 'outbound_call' && outcome === 'no_answer') {
    return {
      preset: 'tomorrow_morning',
      dueAt: inHours(settings.noAnswerFollowUpHours),
      reason: 'Retry the call after no answer',
      recommendedMethod: 'phone_call',
      isWaiting: false,
    }
  }

  if (activityType === 'voicemail_left' || outcome === 'left_voicemail') {
    return {
      preset: 'in_two_days',
      dueAt: inHours(settings.voicemailFollowUpHours),
      reason: 'Follow up on the voicemail',
      recommendedMethod: 'phone_call',
      isWaiting: false,
    }
  }

  if (activityType === 'outbound_text') {
    return {
      preset: 'tomorrow_morning',
      dueAt: inHours(settings.textNoReplyFollowUpHours),
      reason: 'Follow up if the text goes unanswered',
      recommendedMethod: 'phone_call',
      isWaiting: false,
    }
  }

  if (activityType === 'outbound_email') {
    return {
      preset: 'in_two_days',
      dueAt: inHours(settings.emailNoReplyFollowUpHours),
      reason: 'Follow up if the email goes unanswered',
      recommendedMethod: 'phone_call',
      isWaiting: false,
    }
  }

  // A conversation that went somewhere: keep the thread alive tomorrow.
  if (outcome === 'connected' || outcome === 'replied') {
    return {
      preset: 'tomorrow_morning',
      dueAt: inHours(settings.quoteSentFollowUpHours),
      reason: 'Continue the conversation',
      recommendedMethod: null,
      isWaiting: false,
    }
  }

  if (outcome === 'no_reply') {
    return {
      preset: 'tomorrow_morning',
      dueAt: inHours(settings.textNoReplyFollowUpHours),
      reason: 'No reply yet',
      recommendedMethod: 'phone_call',
      isWaiting: false,
    }
  }

  return null
}

/**
 * The default response deadline when parking a customer as "waiting".
 * Waiting is always bounded — that is what stops it becoming a dead end.
 */
export function defaultWaitingDeadline(settings: UserSettings, now: Date = new Date()): Date {
  return new Date(now.getTime() + settings.waitingTimeoutHours * 3_600_000)
}

/**
 * Converts a `datetime-local` form value to an instant in the operator's zone.
 * Returns null for anything unparseable, so an empty picker cannot schedule a
 * follow-up at the epoch.
 */
export function parseLocalDateTimeInput(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim())
  if (match === null) return null

  const [, year, month, day, hour, minute] = match
  const parts = {
    year: Number.parseInt(year ?? '0', 10),
    month: Number.parseInt(month ?? '0', 10),
    day: Number.parseInt(day ?? '0', 10),
    hour: Number.parseInt(hour ?? '0', 10),
    minute: Number.parseInt(minute ?? '0', 10),
  }

  if (parts.year < 1970 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) {
    return null
  }

  return zonedWallTimeToInstantSafe(parts, timeZone)
}

function zonedWallTimeToInstantSafe(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date | null {
  const instant = atZonedTimeExact(parts, timeZone)
  return Number.isNaN(instant.getTime()) ? null : instant
}

function atZonedTimeExact(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  // Reuses the same two-pass offset correction as atZonedTime by anchoring on
  // the requested calendar day rather than on "now".
  const anchor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12))
  return atZonedTime(
    anchor,
    timeZone,
    0,
    `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  )
}

/** Formats an instant for a `datetime-local` input in the operator's zone. */
export function toLocalDateTimeInput(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00'

  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`
}
