/**
 * Resolves a parsed command into something to do, or a question to ask.
 *
 * Pure: it takes the working set and returns a plan. Applying the plan is the
 * caller's job, which keeps this testable and lets demo mode and the webhook
 * share one implementation of every rule.
 *
 * The judgement encoded here is that a clear command should just happen — no
 * "reply YES to confirm" on every call, because that doubles the message count
 * and the cost for no safety gain. A command is applied when exactly one
 * customer matches, the action is unambiguous, and confidence clears the
 * threshold. Anything else becomes a question.
 */

import type { CustomerRow } from '../dashboard.ts'
import type { UserSettings } from '../settings.ts'
import { normalizeName, normalizePhone } from '../../lib/normalize.ts'
import { isClosedLeadStatus } from '../vocabulary.ts'
import type { ActivityOutcome, ActivityType, ContactMethod, LeadStatus } from '../vocabulary.ts'
import { MIN_COMMAND_CONFIDENCE, type ParsedCommandResult } from './command-parser.ts'
import { composeQueryResponse } from './messages.ts'
import { formatDateTime } from '../../lib/format.ts'

export type CommandPlan =
  | {
      kind: 'apply'
      customerId: string
      customerName: string
      /** Lines describing what changed, used for the confirmation. */
      changes: string[]
      effects: CommandEffect[]
    }
  | {
      kind: 'reply'
      /** A read-only answer; nothing is written. */
      body: string
    }
  | {
      kind: 'clarify'
      prompt: string
      options: Array<{ label: string; value: string }>
      /** Replayed verbatim once the answer arrives. */
      pendingPayload: Record<string, unknown>
      sessionKind: string
    }
  | { kind: 'rejected'; reason: string }

export type CommandEffect =
  | {
      type: 'log_activity'
      activityType: ActivityType
      direction: 'outbound' | 'inbound'
      method: ContactMethod | null
      outcome: ActivityOutcome | null
      summary: string
    }
  | { type: 'schedule_follow_up'; dueAt: string; reason: string; isAppointment: boolean }
  | { type: 'set_waiting'; waitingUntil: string; reason: string }
  | { type: 'snooze'; until: string }
  | { type: 'complete_follow_up' }
  | { type: 'set_status'; status: LeadStatus }
  | { type: 'add_note'; note: string }

export interface ExecuteContext {
  rows: readonly CustomerRow[]
  settings: UserSettings
  now: Date
  /** Customers with an outstanding reminder, used to disambiguate quick replies. */
  recentReminderCustomerIds?: readonly string[]
  /** A question already asked, whose options a numeric reply selects. */
  openClarification?: {
    options: Array<{ label: string; value: string }>
    pendingPayload: Record<string, unknown>
  } | null
}

export function executeCommand(parsed: ParsedCommandResult, context: ExecuteContext): CommandPlan {
  switch (parsed.intent) {
    case 'help':
      return { kind: 'reply', body: helpText() }

    case 'list_due_today':
      return { kind: 'reply', body: composeQueryResponse('DUE TODAY', dueToday(context)) }

    case 'list_overdue':
      return { kind: 'reply', body: composeQueryResponse('OVERDUE', overdue(context)) }

    case 'list_no_next_action':
      return { kind: 'reply', body: composeQueryResponse('NO NEXT ACTION', noNextAction(context)) }

    case 'list_appointments':
      return { kind: 'reply', body: composeQueryResponse('APPOINTMENTS', appointments(context)) }

    case 'list_not_attempted': {
      const method = parsed.queryMethod
      if (method === undefined) return { kind: 'rejected', reason: 'Which channel?' }

      const rows = activeRows(context).filter((row) =>
        row.coverage.methodsNotAttempted.includes(method),
      )
      return { kind: 'reply', body: composeQueryResponse(`NOT YET ${method.toUpperCase()}`, rows) }
    }

    case 'select_option':
      return resolveOption(parsed, context)

    case 'unknown':
      return {
        kind: 'rejected',
        reason: "I could not tell what to do. Reply HELP to see what I understand.",
      }

    default:
      break
  }

  const resolution = resolveCustomer(parsed, context)
  if (resolution.kind !== 'one') return resolution.plan

  const row = resolution.row

  // Below the threshold the app asks rather than acting. One extra message is
  // far cheaper than a wrong write on the wrong customer.
  if (parsed.confidence < MIN_COMMAND_CONFIDENCE && parsed.intent !== 'lookup_customer') {
    return {
      kind: 'clarify',
      sessionKind: 'confirm_command',
      prompt: `Did you mean: ${parsed.summary} for ${row.customer.fullName}?\n\n1. Yes\n2. No`,
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
      pendingPayload: { parsed: parsed as unknown as Record<string, unknown>, customerId: row.customer.id },
    }
  }

  return buildPlan(parsed, row, context)
}

function buildPlan(parsed: ParsedCommandResult, row: CustomerRow, context: ExecuteContext): CommandPlan {
  const effects: CommandEffect[] = []
  const changes: string[] = []
  const { settings } = context

  if (parsed.intent === 'lookup_customer') {
    return { kind: 'reply', body: describeCustomer(row, settings) }
  }

  if (parsed.activity !== undefined) {
    effects.push({
      type: 'log_activity',
      activityType: parsed.activity.type,
      direction: parsed.activity.direction,
      method: parsed.activity.method,
      outcome: parsed.activity.outcome,
      summary: 'Logged from WhatsApp',
    })
    changes.push(parsed.summary)
  }

  if (parsed.intent === 'complete_follow_up') {
    effects.push({ type: 'complete_follow_up' })
    changes.push('Follow-up completed')
  }

  if (parsed.intent === 'snooze_follow_up' && parsed.followUp !== undefined) {
    effects.push({ type: 'snooze', until: parsed.followUp.dueAt })
    changes.push(`Snoozed until ${formatDateTime(parsed.followUp.dueAt, settings.timeZone)}`)
  }

  if (parsed.intent === 'set_waiting' && parsed.waitingUntil !== undefined) {
    effects.push({
      type: 'set_waiting',
      waitingUntil: parsed.waitingUntil,
      reason: 'Waiting for the customer',
    })
    changes.push(
      `Waiting until ${formatDateTime(parsed.waitingUntil, settings.timeZone)}`,
    )
  }

  if (parsed.statusChange !== undefined) {
    effects.push({ type: 'set_status', status: parsed.statusChange })
    changes.push(`Marked ${parsed.statusChange.replace(/_/g, ' ')}`)
  }

  if (parsed.note !== undefined) {
    effects.push({ type: 'add_note', note: parsed.note })
    changes.push('Note added')
  }

  if (
    parsed.followUp !== undefined &&
    parsed.intent !== 'snooze_follow_up' &&
    !isClosedLeadStatus(parsed.statusChange ?? 'working')
  ) {
    const isAppointment = parsed.intent === 'set_appointment'
    effects.push({
      type: 'schedule_follow_up',
      dueAt: parsed.followUp.dueAt,
      reason: isAppointment ? 'Appointment' : 'Follow-up from WhatsApp',
      isAppointment,
    })

    // When the time came from a default rather than the message, the
    // confirmation says so — an assumption should never be silent.
    const when = formatDateTime(parsed.followUp.dueAt, settings.timeZone)
    changes.push(
      parsed.followUp.timeAssumed
        ? `${isAppointment ? 'Appointment' : 'Follow-up'} ${when} (time assumed)`
        : `${isAppointment ? 'Appointment' : 'Follow-up'} ${when}`,
    )
  }

  if (effects.length === 0) {
    return { kind: 'rejected', reason: 'Nothing to change in that message.' }
  }

  return {
    kind: 'apply',
    customerId: row.customer.id,
    customerName: row.customer.fullName,
    changes,
    effects,
  }
}

type Resolution =
  | { kind: 'one'; row: CustomerRow }
  | { kind: 'other'; plan: CommandPlan }

/**
 * Finds the customer a command refers to.
 *
 * When the message names nobody, a quick reply is attached to the most recent
 * reminder — but only when exactly one is outstanding. Two open reminders make
 * a bare "CALLED NO ANSWER" ambiguous, and guessing would file the call against
 * the wrong person.
 */
function resolveCustomer(parsed: ParsedCommandResult, context: ExecuteContext): Resolution {
  const reference = parsed.customerReference
  const rows = activeRows(context)

  if (reference === null) {
    const recent = context.recentReminderCustomerIds ?? []
    const candidates = rows.filter((row) => recent.includes(row.customer.id))

    if (candidates.length === 1 && candidates[0] !== undefined) {
      return { kind: 'one', row: candidates[0] }
    }

    if (candidates.length > 1) {
      return { kind: 'other', plan: askWhich(candidates, parsed, 'Which customer?') }
    }

    return {
      kind: 'other',
      plan: { kind: 'rejected', reason: 'Which customer? Include a name, for example "Called Jesus Ayala".' },
    }
  }

  if (reference.dealershipCustomerId !== undefined) {
    const match = rows.filter(
      (row) => row.customer.dealershipCustomerId === reference.dealershipCustomerId,
    )
    if (match.length === 1 && match[0] !== undefined) return { kind: 'one', row: match[0] }
  }

  if (reference.phoneLastFour !== undefined) {
    const match = rows.filter((row) => {
      const digits = normalizePhone(row.customer.primaryPhone)
      return digits !== null && digits.endsWith(reference.phoneLastFour ?? '')
    })
    if (match.length === 1 && match[0] !== undefined) return { kind: 'one', row: match[0] }
    if (match.length > 1) {
      return { kind: 'other', plan: askWhich(match, parsed, 'Which customer?') }
    }
  }

  const spoken = normalizeName(reference.spokenName ?? '')
  if (spoken === null) {
    return { kind: 'other', plan: { kind: 'rejected', reason: 'I could not tell which customer.' } }
  }

  const exact = rows.filter((row) => row.customer.normalizedName === spoken)
  if (exact.length === 1 && exact[0] !== undefined) return { kind: 'one', row: exact[0] }
  if (exact.length > 1) return { kind: 'other', plan: askWhich(exact, parsed, `I found ${exact.length} customers with that name:`) }

  // Partial matches let "Called Jesus" work when only one Jesus is on file.
  const partial = rows.filter((row) => {
    const name = row.customer.normalizedName
    return name !== null && (name.startsWith(`${spoken} `) || name.includes(` ${spoken}`) || name === spoken)
  })

  if (partial.length === 1 && partial[0] !== undefined) return { kind: 'one', row: partial[0] }
  if (partial.length > 1) {
    return {
      kind: 'other',
      plan: askWhich(partial, parsed, `I found ${partial.length} customers named ${reference.spokenName}:`),
    }
  }

  return {
    kind: 'other',
    plan: { kind: 'rejected', reason: `I could not find a customer called ${reference.spokenName}.` },
  }
}

function askWhich(rows: readonly CustomerRow[], parsed: ParsedCommandResult, heading: string): CommandPlan {
  const options = rows.slice(0, 9).map((row, index) => ({
    label: `${row.customer.fullName}${describePhoneTail(row)}`,
    value: row.customer.id,
    index: index + 1,
  }))

  const prompt = [
    heading,
    '',
    ...options.map((option, index) => `${index + 1}. ${option.label}`),
    '',
    `Reply ${options.map((_, index) => index + 1).join(' or ')}.`,
  ].join('\n')

  return {
    kind: 'clarify',
    sessionKind: 'select_customer',
    prompt,
    options: options.map((option) => ({ label: option.label, value: option.value })),
    pendingPayload: { parsed: parsed as unknown as Record<string, unknown> },
  }
}

/** Answers a question by index, then replays the command it was blocking. */
function resolveOption(parsed: ParsedCommandResult, context: ExecuteContext): CommandPlan {
  const session = context.openClarification
  const index = parsed.customerReference?.optionNumber

  if (session === null || session === undefined || index === undefined) {
    return { kind: 'rejected', reason: 'There is no question waiting for an answer.' }
  }

  const option = session.options[index - 1]
  if (option === undefined) {
    return { kind: 'rejected', reason: `Reply with a number between 1 and ${session.options.length}.` }
  }

  if (option.value === 'no') return { kind: 'rejected', reason: 'Cancelled.' }

  const pending = session.pendingPayload['parsed'] as ParsedCommandResult | undefined
  if (pending === undefined) return { kind: 'rejected', reason: 'That question has expired.' }

  const customerId =
    option.value === 'yes'
      ? (session.pendingPayload['customerId'] as string | undefined)
      : option.value

  const row = context.rows.find((candidate) => candidate.customer.id === customerId)
  if (row === undefined) return { kind: 'rejected', reason: 'That customer is no longer available.' }

  // Replayed at full confidence: the ambiguity that lowered it has been answered.
  return buildPlan({ ...pending, confidence: 1 }, row, context)
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function activeRows(context: ExecuteContext): CustomerRow[] {
  return context.rows.filter((row) => row.customer.archivedAt === null)
}

function overdue(context: ExecuteContext): CustomerRow[] {
  return activeRows(context).filter((row) => row.nextAction.isOverdue)
}

function dueToday(context: ExecuteContext): CustomerRow[] {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: context.settings.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return activeRows(context).filter((row) => {
    if (row.nextAction.dueAt === null) return false
    return key.format(new Date(row.nextAction.dueAt)) === key.format(context.now)
  })
}

function noNextAction(context: ExecuteContext): CustomerRow[] {
  return activeRows(context).filter((row) => row.nextAction.state === 'no_next_action')
}

function appointments(context: ExecuteContext): CustomerRow[] {
  return activeRows(context).filter((row) => row.openFollowUp?.isAppointment === true)
}

function describePhoneTail(row: CustomerRow): string {
  const digits = normalizePhone(row.customer.primaryPhone)
  return digits === null ? '' : ` — phone ending ${digits.slice(-4)}`
}

function describeCustomer(row: CustomerRow, settings: UserSettings): string {
  const lines = [
    row.customer.fullName,
    `Status: ${row.customer.leadStatus.replace(/_/g, ' ')}`,
    `Available: ${row.coverage.methodsAvailable.join(', ') || 'none'}`,
    `Tried by me: ${row.coverage.methodsAttempted.join(', ') || 'nothing yet'}`,
    `Not tried: ${row.coverage.methodsNotAttempted.join(', ') || 'none'}`,
    row.nextAction.dueAt === null
      ? `Next action: ${row.nextAction.reason}`
      : `Next action: ${formatDateTime(row.nextAction.dueAt, settings.timeZone)}`,
  ]

  return lines.join('\n')
}

function helpText(): string {
  return [
    'WHAT I UNDERSTAND',
    '',
    'Log and schedule:',
    'Called Jesus Ayala, no answer. Follow up tomorrow at ten.',
    'Texted Jesus. Waiting for a response.',
    'Snooze Jesus until Monday.',
    'Mark Jesus sold.',
    'Add note to Jesus: wants a bunkhouse.',
    '',
    'Ask:',
    'Who do I need to contact today?',
    'What is overdue?',
    'Who has no next action?',
    'What appointments do I have tomorrow?',
    '',
    'Quick replies:',
    'CALLED NO ANSWER, CALLED ANSWERED, TEXTED, EMAILED,',
    'VOICEMAIL, SNOOZE 2 HOURS, TOMORROW 10 AM, DONE, OPEN',
  ].join('\n')
}
