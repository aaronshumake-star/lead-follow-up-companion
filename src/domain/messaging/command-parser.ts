/**
 * Deterministic WhatsApp command parsing.
 *
 * Rules first, no model. Everything the brief asks for — "Called Jesus Ayala,
 * no answer. Follow up tomorrow at ten." — is recognisable from a fixed
 * vocabulary of verbs, outcomes and date phrases, and a rule-based parser is
 * free, instant, offline, and testable to the letter. An AI provider can be
 * slotted in behind the Phase 1 CommandParsingProvider interface later, but it
 * stays disabled by default because it costs money per message.
 *
 * The text is untrusted. It is parsed into a *proposal*: an intent plus a
 * confidence. Applying it is a separate decision made by the executor, which
 * refuses anything ambiguous and asks instead.
 */

import type { ActivityOutcome, ActivityType, ContactMethod, LeadStatus } from '../vocabulary.ts'
import type { UserSettings } from '../settings.ts'
import { atZonedTime, zonedPartsOf, zonedWallTimeToInstant } from '../../lib/time-zone.ts'
import { readUntrusted, sanitizeUntrustedText } from '../../lib/untrusted.ts'

export const COMMAND_INTENT_NAMES = [
  'log_activity',
  'schedule_follow_up',
  'log_activity_and_schedule',
  'snooze_follow_up',
  'complete_follow_up',
  'set_status',
  'set_waiting',
  'add_note',
  'set_appointment',
  'lookup_customer',
  'list_due_today',
  'list_overdue',
  'list_no_next_action',
  'list_appointments',
  'list_not_attempted',
  'select_option',
  'help',
  'unknown',
] as const
export type CommandIntentName = (typeof COMMAND_INTENT_NAMES)[number]

export interface ParsedCommandResult {
  intent: CommandIntentName
  /** 0–1. Below the executor's threshold the app asks instead of acting. */
  confidence: number
  /** How the message referred to a customer; resolution happens separately. */
  customerReference: {
    spokenName?: string
    phoneLastFour?: string
    dealershipCustomerId?: string
    /** Set when the message was a bare number answering a digest or question. */
    optionNumber?: number
  } | null
  activity?: {
    type: ActivityType
    direction: 'outbound' | 'inbound'
    method: ContactMethod | null
    outcome: ActivityOutcome | null
  }
  followUp?: {
    dueAt: string
    /** True when the time came from a default rather than the message. */
    timeAssumed: boolean
  }
  waitingUntil?: string
  statusChange?: LeadStatus
  note?: string
  /** Channel referenced by "who have I not emailed yet". */
  queryMethod?: ContactMethod
  /** Non-identifying description of what was understood, for the confirmation. */
  summary: string
}

export interface ParseContext {
  settings: UserSettings
  now: Date
  /** True when a question is outstanding, so a bare number is an answer. */
  hasOpenClarification?: boolean
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

interface VerbRule {
  pattern: RegExp
  type: ActivityType
  direction: 'outbound' | 'inbound'
  method: ContactMethod | null
}

const VERBS: VerbRule[] = [
  { pattern: /\bleft (a )?(voice ?mail|vm)\b|\bvoicemail\b|\bvm\b/i, type: 'voicemail_left', direction: 'outbound', method: 'voicemail' },
  { pattern: /\b(called|call|rang|phoned)\b/i, type: 'outbound_call', direction: 'outbound', method: 'phone_call' },
  { pattern: /\b(texted|text|sms|messaged)\b/i, type: 'outbound_text', direction: 'outbound', method: 'sms' },
  { pattern: /\b(emailed|email|e-mailed)\b/i, type: 'outbound_email', direction: 'outbound', method: 'email' },
  { pattern: /\b(met|stopped by|came in|walked in)\b/i, type: 'in_person', direction: 'outbound', method: 'in_person' },
]

const OUTCOMES: Array<{ pattern: RegExp; outcome: ActivityOutcome }> = [
  { pattern: /\bno answer\b|\bdidn'?t answer\b|\bno pick ?up\b|\bnobody answered\b/i, outcome: 'no_answer' },
  { pattern: /\b(he|she|they)? ?answered\b|\bpicked up\b|\bgot (a )?hold of\b|\bspoke (to|with)\b/i, outcome: 'connected' },
  { pattern: /\breplied\b|\bwrote back\b|\bresponded\b|\bgot a reply\b/i, outcome: 'replied' },
  { pattern: /\bno (reply|response)\b|\bhasn'?t (replied|responded)\b/i, outcome: 'no_reply' },
  { pattern: /\bnot interested\b|\bpassed\b|\bwent elsewhere\b|\bbought elsewhere\b/i, outcome: 'not_interested' },
  { pattern: /\bbusy\b/i, outcome: 'busy' },
  { pattern: /\bbad number\b|\bwrong number\b/i, outcome: 'wrong_number' },
  { pattern: /\bappointment\b|\bappt\b/i, outcome: 'appointment_set' },
]

/** Quick replies, matched on the whole message so they cannot fire mid-sentence. */
const QUICK_REPLIES: Array<{ pattern: RegExp; build: (ctx: ParseContext) => Partial<ParsedCommandResult> }> = [
  {
    pattern: /^called\s+no\s+answer$/i,
    build: () => ({
      intent: 'log_activity',
      activity: { type: 'outbound_call', direction: 'outbound', method: 'phone_call', outcome: 'no_answer' },
      summary: 'Called — no answer',
    }),
  },
  {
    pattern: /^called\s+answered$/i,
    build: () => ({
      intent: 'log_activity',
      activity: { type: 'outbound_call', direction: 'outbound', method: 'phone_call', outcome: 'connected' },
      summary: 'Called — answered',
    }),
  },
  {
    pattern: /^texted$/i,
    build: () => ({
      intent: 'log_activity',
      activity: { type: 'outbound_text', direction: 'outbound', method: 'sms', outcome: 'no_reply' },
      summary: 'Sent text',
    }),
  },
  {
    pattern: /^emailed$/i,
    build: () => ({
      intent: 'log_activity',
      activity: { type: 'outbound_email', direction: 'outbound', method: 'email', outcome: 'no_reply' },
      summary: 'Sent email',
    }),
  },
  {
    pattern: /^voicemail$/i,
    build: () => ({
      intent: 'log_activity',
      activity: { type: 'voicemail_left', direction: 'outbound', method: 'voicemail', outcome: 'left_voicemail' },
      summary: 'Left voicemail',
    }),
  },
  {
    pattern: /^done$/i,
    build: () => ({ intent: 'complete_follow_up', summary: 'Follow-up completed' }),
  },
  {
    pattern: /^open$/i,
    build: () => ({ intent: 'lookup_customer', summary: 'Open customer' }),
  },
]

const STATUS_PHRASES: Array<{ pattern: RegExp; status: LeadStatus }> = [
  { pattern: /\bmark(ed)?\s+(as\s+)?sold\b|\bbought (from|with) (us|me)\b|\bsold\b/i, status: 'sold' },
  { pattern: /\bmark(ed)?\s+(as\s+)?lost\b|\bbought elsewhere\b|\bwent elsewhere\b|\blost\b/i, status: 'lost' },
  { pattern: /\bdo not contact\b|\bdnc\b|\bstop contacting\b/i, status: 'do_not_contact' },
  { pattern: /\barchive[d]?\b/i, status: 'archived' },
]

const QUERY_PHRASES: Array<{ pattern: RegExp; intent: CommandIntentName; summary: string }> = [
  { pattern: /\bwho (do i need to|should i) (contact|call)\b|\bdue today\b|\bwhat'?s due\b/i, intent: 'list_due_today', summary: 'Due today' },
  { pattern: /\bwhat('| i)?s? overdue\b|\boverdue\b/i, intent: 'list_overdue', summary: 'Overdue' },
  { pattern: /\bno next action\b|\bnothing scheduled\b|\bforgotten\b/i, intent: 'list_no_next_action', summary: 'No next action' },
  { pattern: /\bappointments?\b.*\b(tomorrow|today|week)\b|\bwhat appointments\b/i, intent: 'list_appointments', summary: 'Appointments' },
]

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseCommand(rawText: string, context: ParseContext): ParsedCommandResult {
  const text = readUntrusted(sanitizeUntrustedText(rawText)).trim()

  if (text === '') return unknown('Empty message')

  if (/^(help|\?|commands)$/i.test(text)) {
    return { intent: 'help', confidence: 1, customerReference: null, summary: 'Help' }
  }

  // A bare number only means something when a question is outstanding.
  const bareNumber = /^(\d{1,2})$/.exec(text)
  if (bareNumber !== null) {
    return {
      intent: 'select_option',
      confidence: context.hasOpenClarification === true ? 0.95 : 0.5,
      customerReference: { optionNumber: Number.parseInt(bareNumber[1] ?? '0', 10) },
      summary: `Option ${bareNumber[1]}`,
    }
  }

  for (const reply of QUICK_REPLIES) {
    if (!reply.pattern.test(text)) continue
    return {
      confidence: 0.95,
      customerReference: null,
      intent: 'unknown',
      summary: '',
      ...reply.build(context),
    } as ParsedCommandResult
  }

  // "SNOOZE 2 HOURS" / "snooze Jesus until Monday"
  const snooze = parseSnooze(text, context)
  if (snooze !== null) return snooze

  // "TOMORROW 10 AM" as a standalone reply reschedules the current reminder.
  const bareSchedule = parseBareSchedule(text, context)
  if (bareSchedule !== null) return bareSchedule

  for (const query of QUERY_PHRASES) {
    if (!query.pattern.test(text)) continue
    return { intent: query.intent, confidence: 0.9, customerReference: null, summary: query.summary }
  }

  const notAttempted = /\bwho have i not (\w+)(ed)? yet\b|\bnot (\w+)ed yet\b/i.exec(text)
  if (notAttempted !== null) {
    const method = methodFromWord(notAttempted[1] ?? notAttempted[3] ?? '')
    if (method !== null) {
      return {
        intent: 'list_not_attempted',
        confidence: 0.85,
        customerReference: null,
        queryMethod: method,
        summary: `Not yet contacted by ${method.replace(/_/g, ' ')}`,
      }
    }
  }

  const note = /\badd (a )?note (to|for) (.+?):\s*(.+)$/i.exec(text)
  if (note !== null) {
    return {
      intent: 'add_note',
      confidence: 0.9,
      customerReference: { spokenName: cleanName(note[3] ?? '') },
      note: (note[4] ?? '').trim().slice(0, 500),
      summary: 'Note added',
    }
  }

  const reference = extractCustomerReference(text)
  const activity = matchActivity(text)
  const outcome = matchOutcome(text)
  const schedule = parseWhen(text, context)
  const status = matchStatus(text)
  const waiting = parseWaiting(text, context)
  const appointment = parseAppointment(text, context)

  if (appointment !== null) {
    return {
      intent: 'set_appointment',
      confidence: reference === null ? 0.5 : 0.9,
      customerReference: reference,
      followUp: appointment,
      summary: 'Appointment set',
    }
  }

  if (waiting !== null) {
    return {
      intent: 'set_waiting',
      confidence: reference === null ? 0.5 : 0.88,
      customerReference: reference,
      waitingUntil: waiting,
      summary: 'Marked waiting for customer',
    }
  }

  if (status !== null) {
    return {
      intent: 'set_status',
      confidence: reference === null ? 0.5 : 0.9,
      customerReference: reference,
      statusChange: status,
      summary: `Marked ${status.replace(/_/g, ' ')}`,
    }
  }

  if (activity !== null && schedule !== null) {
    return {
      intent: 'log_activity_and_schedule',
      confidence: scoreFor(reference, true, true),
      customerReference: reference,
      activity: { ...activity, outcome },
      followUp: schedule,
      summary: describeActivity(activity, outcome),
    }
  }

  if (activity !== null) {
    return {
      intent: 'log_activity',
      confidence: scoreFor(reference, true, false),
      customerReference: reference,
      activity: { ...activity, outcome },
      summary: describeActivity(activity, outcome),
    }
  }

  if (schedule !== null) {
    return {
      intent: 'schedule_follow_up',
      confidence: scoreFor(reference, false, true),
      customerReference: reference,
      followUp: schedule,
      summary: 'Follow-up scheduled',
    }
  }

  if (reference !== null) {
    return {
      intent: 'lookup_customer',
      confidence: 0.6,
      customerReference: reference,
      summary: 'Customer lookup',
    }
  }

  return unknown('Could not tell what to do')
}

// ---------------------------------------------------------------------------
// Fragment parsers
// ---------------------------------------------------------------------------

function matchActivity(text: string): { type: ActivityType; direction: 'outbound' | 'inbound'; method: ContactMethod | null } | null {
  for (const verb of VERBS) {
    if (!verb.pattern.test(text)) continue
    return { type: verb.type, direction: verb.direction, method: verb.method }
  }
  return null
}

function matchOutcome(text: string): ActivityOutcome | null {
  for (const rule of OUTCOMES) {
    if (rule.pattern.test(text)) return rule.outcome
  }
  return null
}

function matchStatus(text: string): LeadStatus | null {
  for (const rule of STATUS_PHRASES) {
    if (rule.pattern.test(text)) return rule.status
  }
  return null
}

function parseWaiting(text: string, context: ParseContext): string | null {
  if (!/\bwaiting\b|\bwait for\b|\bhold(ing)? (for|until)\b/i.test(text)) return null

  const when = parseWhen(text, context)
  if (when !== null) return when.dueAt

  return new Date(
    context.now.getTime() + context.settings.waitingTimeoutHours * 3_600_000,
  ).toISOString()
}

function parseAppointment(text: string, context: ParseContext): { dueAt: string; timeAssumed: boolean } | null {
  if (!/\bappointment\b|\bappt\b|\bcoming in\b|\bwalk ?through\b/i.test(text)) return null
  return parseWhen(text, context)
}

function parseSnooze(text: string, context: ParseContext): ParsedCommandResult | null {
  if (!/\bsnooze\b/i.test(text)) return null

  const when = parseWhen(text, context)
  const relative = /\bsnooze\s+(\d{1,3})\s*(hour|hr|h|day|d|minute|min)s?\b/i.exec(text)

  let dueAt: string
  if (relative !== null) {
    const amount = Number.parseInt(relative[1] ?? '0', 10)
    const unit = (relative[2] ?? '').toLowerCase()
    const ms = unit.startsWith('m') ? 60_000 : unit.startsWith('h') ? 3_600_000 : 86_400_000
    dueAt = new Date(context.now.getTime() + amount * ms).toISOString()
  } else if (when !== null) {
    dueAt = when.dueAt
  } else {
    return null
  }

  return {
    intent: 'snooze_follow_up',
    confidence: 0.9,
    customerReference: extractCustomerReference(text),
    followUp: { dueAt, timeAssumed: when?.timeAssumed ?? false },
    summary: 'Snoozed',
  }
}

/** "TOMORROW 10 AM" on its own reschedules whatever the last reminder was. */
function parseBareSchedule(text: string, context: ParseContext): ParsedCommandResult | null {
  if (!/^(tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in \d)/i.test(text)) {
    return null
  }
  if (matchActivity(text) !== null) return null

  const when = parseWhen(text, context)
  if (when === null) return null

  return {
    intent: 'schedule_follow_up',
    confidence: 0.85,
    customerReference: extractCustomerReference(text),
    followUp: when,
    summary: 'Follow-up scheduled',
  }
}

/**
 * Relative and absolute date phrases, resolved in the operator's zone.
 *
 * When a date is given without a time, the configured morning or afternoon
 * default is used and `timeAssumed` is set — the confirmation then states the
 * chosen time, so an assumption is always visible rather than silent.
 */
export function parseWhen(
  text: string,
  context: ParseContext,
): { dueAt: string; timeAssumed: boolean } | null {
  const { settings, now } = context
  const zone = settings.timeZone

  const time = parseTimeOfDay(text)

  const inAmount = /\bin\s+(\d{1,3})\s*(minute|min|hour|hr|h|day|d|week|w)s?\b/i.exec(text)
  if (inAmount !== null) {
    const amount = Number.parseInt(inAmount[1] ?? '0', 10)
    const unit = (inAmount[2] ?? '').toLowerCase()
    const ms = unit.startsWith('min')
      ? 60_000
      : unit.startsWith('h')
        ? 3_600_000
        : unit.startsWith('d')
          ? 86_400_000
          : 604_800_000

    return { dueAt: new Date(now.getTime() + amount * ms).toISOString(), timeAssumed: false }
  }

  const morning = /\btomorrow morning\b/i.test(text)
  const afternoon = /\btomorrow afternoon\b/i.test(text)

  if (morning || afternoon) {
    const wall = morning ? settings.morningAt : settings.afternoonAt
    return { dueAt: atZonedTime(now, zone, 1, time ?? wall).toISOString(), timeAssumed: time === null }
  }

  if (/\btomorrow\b/i.test(text)) {
    return {
      dueAt: atZonedTime(now, zone, 1, time ?? settings.morningAt).toISOString(),
      timeAssumed: time === null,
    }
  }

  if (/\b(later )?today\b|\bthis afternoon\b/i.test(text)) {
    if (time !== null) return { dueAt: atZonedTime(now, zone, 0, time).toISOString(), timeAssumed: false }
    return { dueAt: new Date(now.getTime() + 3 * 3_600_000).toISOString(), timeAssumed: true }
  }

  if (/\bnext week\b/i.test(text)) {
    return {
      dueAt: atZonedTime(now, zone, 7, time ?? settings.morningAt).toISOString(),
      timeAssumed: time === null,
    }
  }

  const weekday = /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text)
  if (weekday !== null) {
    const target = WEEKDAYS.indexOf((weekday[2] ?? '').toLowerCase())
    const forceNextWeek = weekday[1] !== undefined
    const offset = daysUntilWeekday(now, zone, target, forceNextWeek)

    return {
      dueAt: atZonedTime(now, zone, offset, time ?? settings.morningAt).toISOString(),
      timeAssumed: time === null,
    }
  }

  // A bare time with no date means the next occurrence of that time.
  if (time !== null) {
    const todayAt = atZonedTime(now, zone, 0, time)
    const target = todayAt.getTime() > now.getTime() ? todayAt : atZonedTime(now, zone, 1, time)
    return { dueAt: target.toISOString(), timeAssumed: false }
  }

  return null
}

/** "at ten", "at 2:30", "10 am", "2pm". Returns "HH:MM" or null. */
function parseTimeOfDay(text: string): string | null {
  const numeric = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text)
  if (numeric !== null) {
    let hour = Number.parseInt(numeric[1] ?? '0', 10)
    const minute = Number.parseInt(numeric[2] ?? '0', 10)
    const meridiem = (numeric[3] ?? '').toLowerCase()

    if (meridiem === 'pm' && hour < 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
    if (hour > 23 || minute > 59) return null

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  const at = /\bat\s+(\d{1,2})(?::(\d{2}))?\b/i.exec(text)
  if (at !== null) {
    const hour = Number.parseInt(at[1] ?? '0', 10)
    const minute = Number.parseInt(at[2] ?? '0', 10)
    if (hour > 23 || minute > 59) return null

    // "at ten" on a working day means the morning, not 22:00.
    const resolved = hour >= 1 && hour <= 7 ? hour + 12 : hour
    return `${String(resolved).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  const words: Record<string, string> = {
    ten: '10:00',
    eleven: '11:00',
    noon: '12:00',
    twelve: '12:00',
    one: '13:00',
    two: '14:00',
    three: '15:00',
    four: '16:00',
    five: '17:00',
    six: '18:00',
    nine: '09:00',
    eight: '08:00',
    seven: '07:00',
  }

  const word = /\bat\s+(ten|eleven|noon|twelve|one|two|three|four|five|six|seven|eight|nine)\b/i.exec(text)
  if (word !== null) return words[(word[1] ?? '').toLowerCase()] ?? null

  return null
}

function daysUntilWeekday(now: Date, timeZone: string, target: number, forceNextWeek: boolean): number {
  const parts = zonedPartsOf(now, timeZone)
  const localMidnight = zonedWallTimeToInstant({ ...parts, hour: 12, minute: 0 }, timeZone)
  const currentDay = new Date(localMidnight).getUTCDay()

  let offset = (target - currentDay + 7) % 7
  if (offset === 0) offset = 7
  if (forceNextWeek && offset < 7) offset += 7

  return offset
}

/**
 * Pulls a customer reference out of the message.
 *
 * Names are taken after a verb or a preposition, which is what distinguishes
 * "Called Jesus Ayala" from "Called about the bunkhouse". A last-four match is
 * supported because that is how a dealership disambiguates two people by phone.
 */
export function extractCustomerReference(text: string): ParsedCommandResult['customerReference'] {
  const lastFour = /\b(?:ending|last four|x{2,4})\s*(\d{4})\b/i.exec(text)
  if (lastFour !== null) return { phoneLastFour: lastFour[1] }

  const dealerId = /\b([A-Z]{2,4}-\d{3,8})\b/.exec(text)
  if (dealerId !== null) return { dealershipCustomerId: dealerId[1] }

  const afterVerb =
    // The verb is matched in either case, but the name group stays
    // case-sensitive: capitalisation is what distinguishes "Called Jesus Ayala"
    // from "Called about the bunkhouse".
    /\b(?:[Cc]alled|[Cc]all|[Tt]exted|[Tt]ext|[Ee]mailed|[Ee]mail|[Mm]essaged|[Mm]et|[Ss]nooze|[Mm]ark|[Rr]emind|[Nn]ote (?:to|for))\s+((?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*){0,2})/.exec(
      text,
    )
  if (afterVerb !== null) {
    const name = cleanName(afterVerb[1] ?? '')
    if (name !== '') return { spokenName: name }
  }

  // "Jesus has an appointment Saturday at two" — name leads the sentence.
  const leading = /^((?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*){0,2})\b/.exec(text)
  if (leading !== null) {
    const name = cleanName(leading[1] ?? '')
    if (name !== '' && !isCommandWord(name)) return { spokenName: name }
  }

  return null
}

/**
 * Words that cannot begin a customer name.
 *
 * The leading-name heuristic exists so "Jesus has an appointment Saturday"
 * works, but a sentence starting with an imperative is an instruction, not a
 * person — and treating "Ignore previous instructions…" as a customer called
 * "Ignore" would hand injected text a confidence it has not earned.
 */
const COMMAND_WORDS = new Set([
  'called', 'call', 'texted', 'text', 'emailed', 'email', 'snooze', 'mark', 'add', 'who',
  'what', 'when', 'remind', 'done', 'open', 'help', 'tomorrow', 'today', 'next', 'voicemail',
  'ignore', 'disregard', 'forget', 'override', 'execute', 'run', 'delete', 'remove', 'drop',
  'update', 'set', 'send', 'show', 'list', 'find', 'make', 'create', 'cancel', 'stop',
  'please', 'system', 'admin', 'all', 'every', 'everyone',
])

function isCommandWord(name: string): boolean {
  return COMMAND_WORDS.has(name.toLowerCase().split(/\s+/)[0] ?? '')
}

function cleanName(value: string): string {
  return value
    .replace(/[.,;:!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function methodFromWord(word: string): ContactMethod | null {
  const lower = word.toLowerCase()
  if (lower.startsWith('call') || lower.startsWith('phon')) return 'phone_call'
  if (lower.startsWith('text') || lower.startsWith('sms')) return 'sms'
  if (lower.startsWith('email') || lower.startsWith('e-mail')) return 'email'
  if (lower.startsWith('whats')) return 'whatsapp'

  return null
}

function describeActivity(
  activity: { type: ActivityType; method: ContactMethod | null },
  outcome: ActivityOutcome | null,
): string {
  const verb =
    activity.type === 'outbound_call'
      ? 'Called'
      : activity.type === 'outbound_text'
        ? 'Texted'
        : activity.type === 'outbound_email'
          ? 'Emailed'
          : activity.type === 'voicemail_left'
            ? 'Left voicemail'
            : 'Contacted'

  if (outcome === null) return verb
  if (outcome === 'no_answer') return `${verb} — no answer`
  if (outcome === 'connected') return `${verb} — answered`
  if (outcome === 'replied') return `${verb} — replied`
  if (outcome === 'no_reply') return `${verb} — no reply`

  return `${verb} — ${outcome.replace(/_/g, ' ')}`
}

/**
 * Confidence, driven by how much of the command was actually understood.
 * A missing customer is the biggest penalty: acting on the wrong person is the
 * one mistake worth an extra round trip to avoid.
 */
function scoreFor(
  reference: ParsedCommandResult['customerReference'],
  hasActivity: boolean,
  hasSchedule: boolean,
): number {
  let score = 0.5
  if (reference !== null) score += 0.35
  if (hasActivity) score += 0.1
  if (hasSchedule) score += 0.05

  return Math.min(1, Number(score.toFixed(2)))
}

function unknown(summary: string): ParsedCommandResult {
  return { intent: 'unknown', confidence: 0, customerReference: null, summary }
}

/** Below this the app asks a question instead of acting. */
export const MIN_COMMAND_CONFIDENCE = 0.75
