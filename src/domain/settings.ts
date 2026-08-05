/**
 * Per-user scheduling preferences.
 *
 * The defaults encode the habits described in the brief — an unanswered call is
 * worth retrying tomorrow, a voicemail deserves two days before chasing again —
 * and they mirror the column defaults added in
 * supabase/migrations/20260806000100_phase2_manual_tracker.sql so a profile row
 * and an unsaved local one behave identically.
 */

import type { DateTimeDisplay, Profile } from './models.ts'
import type { LeadPriority } from './vocabulary.ts'

export interface UserSettings {
  timeZone: string
  /** "Tomorrow morning" resolves to this local time. */
  morningAt: string
  /** "Tomorrow afternoon" resolves to this local time. */
  afternoonAt: string
  noAnswerFollowUpHours: number
  voicemailFollowUpHours: number
  textNoReplyFollowUpHours: number
  emailNoReplyFollowUpHours: number
  quoteSentFollowUpHours: number
  /** How long to wait on a customer before the follow-up becomes actionable. */
  waitingTimeoutHours: number
  defaultLeadPriority: LeadPriority
  dateTimeDisplay: DateTimeDisplay
}

export const DEFAULT_SETTINGS: UserSettings = {
  timeZone: 'America/Chicago',
  morningAt: '09:00',
  afternoonAt: '14:00',
  noAnswerFollowUpHours: 24,
  voicemailFollowUpHours: 48,
  textNoReplyFollowUpHours: 24,
  emailNoReplyFollowUpHours: 48,
  quoteSentFollowUpHours: 24,
  waitingTimeoutHours: 72,
  defaultLeadPriority: 'normal',
  dateTimeDisplay: 'relative',
}

export function settingsFromProfile(profile: Profile): UserSettings {
  return {
    timeZone: profile.timeZone,
    morningAt: profile.morningAt,
    afternoonAt: profile.afternoonAt,
    noAnswerFollowUpHours: profile.noAnswerFollowUpHours,
    voicemailFollowUpHours: profile.voicemailFollowUpHours,
    textNoReplyFollowUpHours: profile.textNoReplyFollowUpHours,
    emailNoReplyFollowUpHours: profile.emailNoReplyFollowUpHours,
    quoteSentFollowUpHours: profile.quoteSentFollowUpHours,
    waitingTimeoutHours: profile.waitingTimeoutHours,
    defaultLeadPriority: profile.defaultLeadPriority,
    dateTimeDisplay: profile.dateTimeDisplay,
  }
}

const HOUR_FIELDS = [
  'noAnswerFollowUpHours',
  'voicemailFollowUpHours',
  'textNoReplyFollowUpHours',
  'emailNoReplyFollowUpHours',
  'quoteSentFollowUpHours',
  'waitingTimeoutHours',
] as const

export interface SettingsValidationResult {
  settings: UserSettings
  errors: Partial<Record<keyof UserSettings, string>>
}

/**
 * Validates settings before they are saved, matching the database check
 * constraints rather than trusting the form. An invalid field keeps its
 * previous value so a typo cannot leave the app without a usable default.
 */
export function validateSettings(
  candidate: UserSettings,
  previous: UserSettings = DEFAULT_SETTINGS,
): SettingsValidationResult {
  const errors: Partial<Record<keyof UserSettings, string>> = {}
  const settings: UserSettings = { ...candidate }

  if (!isValidTimeZone(candidate.timeZone)) {
    errors.timeZone = 'Not a recognised time zone'
    settings.timeZone = previous.timeZone
  }

  for (const field of ['morningAt', 'afternoonAt'] as const) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate[field])) {
      errors[field] = 'Use 24-hour HH:MM'
      settings[field] = previous[field]
    }
  }

  for (const field of HOUR_FIELDS) {
    const value = candidate[field]
    if (!Number.isInteger(value) || value < 1 || value > 8760) {
      errors[field] = 'Between 1 and 8760 hours'
      settings[field] = previous[field]
    }
  }

  return { settings, errors }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}
