/**
 * Command parsing: turning a WhatsApp message or voice transcript into a
 * proposed change.
 *
 * The word "proposed" is the important part. A parser returns an intent with a
 * confidence score and the app decides whether to apply it, ask for
 * clarification, or reject it. Untrusted text never reaches the database as a
 * committed change on its own authority.
 *
 * Worked example from the brief — "Called Jesus Ayala. No answer. Follow up
 * tomorrow at ten." — parses to a single `log_activity_and_schedule` intent
 * carrying the customer reference, the activity, the outcome and the new
 * follow-up time.
 */

import type { ProviderInfo, ProviderResult } from '../types.ts'
import type { ActivityOutcome, ActivityType, ContactMethod, LeadStatus } from '../../domain/vocabulary.ts'
import type { UntrustedText } from '../../lib/untrusted.ts'

export const COMMAND_INTENTS = [
  'log_activity',
  'schedule_follow_up',
  'log_activity_and_schedule',
  'snooze_follow_up',
  'complete_follow_up',
  'set_status',
  'lookup_customer',
  'list_due_today',
  'list_overdue',
  'list_no_next_action',
  'help',
  'unknown',
] as const
export type CommandIntent = (typeof COMMAND_INTENTS)[number]

/**
 * How the parser referred to a customer. Resolution to an id happens separately
 * against the database, because a spoken name is frequently ambiguous and the
 * app must be able to answer "did you mean?" instead of guessing.
 */
export interface CustomerReference {
  spokenName?: string
  phone?: string
  dealershipCustomerId?: string
}

export interface ParsedCommand {
  intent: CommandIntent
  /** 0–1. Below the app's threshold the command is queried, never applied. */
  confidence: number
  customer?: CustomerReference
  activity?: {
    type: ActivityType
    method?: ContactMethod
    outcome?: ActivityOutcome
    summary?: string
  }
  followUp?: {
    /** Absolute ISO timestamp resolved against the profile's time zone. */
    dueAt: string
    reason?: string
    recommendedMethod?: ContactMethod
  }
  statusChange?: { leadStatus: LeadStatus }
  snooze?: { until: string }
  /** What the app should say back, so the confirmation matches what it did. */
  confirmationHint?: string
}

export interface CommandParsingInput {
  /** The message body or voice transcript. Untrusted by construction. */
  text: UntrustedText
  /** IANA zone used to resolve "tomorrow at ten" into an absolute instant. */
  timeZone: string
  /** Anchor for relative expressions; injected so parsing is testable. */
  now: Date
}

export interface CommandParsingProvider {
  readonly info: ProviderInfo
  parse(input: CommandParsingInput): Promise<ProviderResult<ParsedCommand>>
}

/**
 * Below this, the app asks a clarifying question over WhatsApp instead of
 * acting. One extra message is far cheaper than silently corrupting a record.
 */
export const MIN_AUTO_APPLY_CONFIDENCE = 0.75
