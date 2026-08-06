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

  // --- screenshot intake ---------------------------------------------------
  /** When off, every screenshot goes to review instead of writing directly. */
  autoImportEnabled: boolean
  autoFollowUpOnImport: boolean
  /** A lead arriving before this hour gets a same-day follow-up. */
  newLeadSameDayCutoffHour: number
  sameDayFollowUpDelayHours: number

  // --- reminders -----------------------------------------------------------
  /** Master switch. Off means the dashboard is the only surface. */
  remindersEnabled: boolean
  individualRemindersEnabled: boolean
  /** Collapses individual reminders into digests to cut message count. */
  digestOnly: boolean
  morningDigestEnabled: boolean
  endOfDayDigestEnabled: boolean
  endOfDayDigestAt: string
  appointmentReminderLeadHours: number
  /** How long before an already-notified overdue follow-up is chased again. */
  overdueReminderIntervalHours: number
  reminderMaxAttempts: number

  // --- cost ----------------------------------------------------------------
  annualCostThresholdUsd: number
  voiceMessagesPerDay: number
  transcriptionConfidenceThreshold: number
  failedAudioRetentionHours: number
  retainFailedTranscripts: boolean
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

  autoImportEnabled: true,
  autoFollowUpOnImport: true,
  newLeadSameDayCutoffHour: 16,
  sameDayFollowUpDelayHours: 3,

  remindersEnabled: true,
  individualRemindersEnabled: true,
  digestOnly: false,
  morningDigestEnabled: true,
  endOfDayDigestEnabled: true,
  endOfDayDigestAt: '17:30',
  appointmentReminderLeadHours: 24,
  overdueReminderIntervalHours: 24,
  reminderMaxAttempts: 3,

  annualCostThresholdUsd: 50,
  voiceMessagesPerDay: 20,
  transcriptionConfidenceThreshold: 0.65,
  failedAudioRetentionHours: 24,
  retainFailedTranscripts: false,
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

    autoImportEnabled: profile.autoImportEnabled,
    autoFollowUpOnImport: profile.autoFollowUpOnImport,
    newLeadSameDayCutoffHour: profile.newLeadSameDayCutoffHour,
    sameDayFollowUpDelayHours: profile.sameDayFollowUpDelayHours,

    remindersEnabled: profile.remindersEnabled,
    individualRemindersEnabled: profile.individualRemindersEnabled,
    digestOnly: profile.digestOnly,
    morningDigestEnabled: profile.morningDigestEnabled,
    endOfDayDigestEnabled: profile.endOfDayDigestEnabled,
    endOfDayDigestAt: profile.endOfDayDigestAt,
    appointmentReminderLeadHours: profile.appointmentReminderLeadHours,
    overdueReminderIntervalHours: profile.overdueReminderIntervalHours,
    reminderMaxAttempts: profile.reminderMaxAttempts,

    annualCostThresholdUsd: profile.annualCostThresholdUsd,
    voiceMessagesPerDay: profile.voiceMessagesPerDay,
    transcriptionConfidenceThreshold: profile.transcriptionConfidenceThreshold,
    failedAudioRetentionHours: profile.failedAudioRetentionHours,
    retainFailedTranscripts: profile.retainFailedTranscripts,
  }
}

const HOUR_FIELDS = [
  'noAnswerFollowUpHours',
  'voicemailFollowUpHours',
  'textNoReplyFollowUpHours',
  'emailNoReplyFollowUpHours',
  'quoteSentFollowUpHours',
  'waitingTimeoutHours',
  'appointmentReminderLeadHours',
  'overdueReminderIntervalHours',
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

  for (const field of ['morningAt', 'afternoonAt', 'endOfDayDigestAt'] as const) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate[field])) {
      errors[field] = 'Use 24-hour HH:MM'
      settings[field] = previous[field]
    }
  }

  if (
    !Number.isInteger(candidate.newLeadSameDayCutoffHour) ||
    candidate.newLeadSameDayCutoffHour < 0 ||
    candidate.newLeadSameDayCutoffHour > 23
  ) {
    errors.newLeadSameDayCutoffHour = 'Between 0 and 23'
    settings.newLeadSameDayCutoffHour = previous.newLeadSameDayCutoffHour
  }

  if (!Number.isInteger(candidate.voiceMessagesPerDay) || candidate.voiceMessagesPerDay < 0 || candidate.voiceMessagesPerDay > 100) {
    errors.voiceMessagesPerDay = 'Between 0 and 100 messages'
    settings.voiceMessagesPerDay = previous.voiceMessagesPerDay
  }
  if (candidate.transcriptionConfidenceThreshold < 0 || candidate.transcriptionConfidenceThreshold > 1) {
    errors.transcriptionConfidenceThreshold = 'Between 0 and 1'
    settings.transcriptionConfidenceThreshold = previous.transcriptionConfidenceThreshold
  }

  if (
    !Number.isInteger(candidate.sameDayFollowUpDelayHours) ||
    candidate.sameDayFollowUpDelayHours < 1 ||
    candidate.sameDayFollowUpDelayHours > 12
  ) {
    errors.sameDayFollowUpDelayHours = 'Between 1 and 12 hours'
    settings.sameDayFollowUpDelayHours = previous.sameDayFollowUpDelayHours
  }

  // Capped at three so a provider outage cannot bill in a loop, matching the
  // notification_log attempt_count constraint.
  if (
    !Number.isInteger(candidate.reminderMaxAttempts) ||
    candidate.reminderMaxAttempts < 1 ||
    candidate.reminderMaxAttempts > 3
  ) {
    errors.reminderMaxAttempts = 'Between 1 and 3 attempts'
    settings.reminderMaxAttempts = previous.reminderMaxAttempts
  }

  if (
    !Number.isFinite(candidate.annualCostThresholdUsd) ||
    candidate.annualCostThresholdUsd < 0 ||
    candidate.annualCostThresholdUsd > 10000
  ) {
    errors.annualCostThresholdUsd = 'Between 0 and 10000'
    settings.annualCostThresholdUsd = previous.annualCostThresholdUsd
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
