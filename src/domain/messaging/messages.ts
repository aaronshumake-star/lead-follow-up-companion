/**
 * WhatsApp message bodies.
 *
 * Plain text, short, and shaped so the reply options are obvious — the whole
 * point is answering from a phone between customers. Every message names the
 * three communication facts the product is built on: what channels exist, what
 * I have personally tried, and what I have not.
 *
 * Customer data does appear in these bodies, because that is the message. What
 * must never carry it is the stored `payloadSummary` and any log line, which is
 * why summaries are built separately and kept short.
 */

import type { CustomerRow } from '../dashboard.ts'
import type { UserSettings } from '../settings.ts'
import { CONTACT_METHOD_LABELS } from '../vocabulary.ts'
import type { ContactMethod } from '../vocabulary.ts'
import { effectiveDueAt } from '../next-action.ts'
import { formatRelative } from '../../lib/format.ts'

/** The replies a reminder advertises. Kept identical across message kinds. */
export const QUICK_REPLY_HINTS = [
  'CALLED NO ANSWER',
  'CALLED ANSWERED',
  'TEXTED',
  'EMAILED',
  'VOICEMAIL',
  'SNOOZE 2 HOURS',
  'TOMORROW 10 AM',
  'OPEN',
] as const

export function composeIndividualReminder(row: CustomerRow, _settings: UserSettings): string {
  const followUp = row.openFollowUp
  const overdue = followUp !== null && new Date(effectiveDueAt(followUp)).getTime() <= Date.now()

  const lines = [
    overdue ? 'FOLLOW-UP OVERDUE' : 'FOLLOW-UP DUE',
    '',
    row.customer.fullName,
  ]

  if (row.primaryVehicle !== null) {
    lines.push(`Unit: ${describeUnit(row)}`)
  }

  lines.push(`Last action: ${describeLastAction(row)}`)
  lines.push(`Available: ${methodList(row.coverage.methodsAvailable)}`)
  lines.push(`Tried: ${methodList(row.coverage.methodsAttempted)}`)
  lines.push(`Not tried: ${methodList(row.coverage.methodsNotAttempted)}`)

  if (followUp !== null && followUp.reason !== null) lines.push(`Reason: ${followUp.reason}`)
  if (followUp !== null) {
    lines.push(`Due: ${formatRelative(effectiveDueAt(followUp))}`)
  }

  lines.push('', 'Reply:', ...QUICK_REPLY_HINTS)

  return lines.join('\n')
}

export function composeWaitingReminder(row: CustomerRow, _settings: UserSettings): string {
  const lines = [
    'WAITING PERIOD ELAPSED',
    '',
    row.customer.fullName,
    `Waited: ${row.msWaiting === null ? 'unknown' : describeDuration(row.msWaiting)}`,
    `Last attempt: ${
      row.coverage.lastOutboundAttemptAt === null
        ? 'none'
        : formatRelative(row.coverage.lastOutboundAttemptAt)
    }`,
    `No response received. Back in Action Required.`,
    `Not tried: ${methodList(row.coverage.methodsNotAttempted)}`,
    '',
    'Reply:',
    ...QUICK_REPLY_HINTS,
  ]

  return lines.join('\n')
}

export function composeAppointmentReminder(row: CustomerRow, _settings: UserSettings): string {
  const followUp = row.openFollowUp

  const lines = [
    'APPOINTMENT COMING UP',
    '',
    row.customer.fullName,
    followUp === null ? '' : `When: ${formatRelative(effectiveDueAt(followUp))}`,
    row.primaryVehicle === null ? '' : `Unit: ${describeUnit(row)}`,
    followUp === null || followUp.reason === null ? '' : `Notes: ${followUp.reason}`,
    '',
    'Reply CONFIRMED, TEXTED, or SNOOZE 2 HOURS',
  ].filter((line) => line !== '')

  return lines.join('\n')
}

export interface ComposedDigest {
  body: string
  /** Identifier-light; this is what gets stored and logged. */
  summary: string
}

/**
 * A digest of everything that needs attention.
 *
 * Numbered so a reply of "2" selects a customer, which keeps the common case to
 * two taps and one billable conversation instead of one message per lead.
 */
export function composeDigest(
  stage: 'morning_digest' | 'end_of_day_digest',
  rows: readonly CustomerRow[],
  settings: UserSettings,
  now: Date,
): ComposedDigest | null {
  const active = rows.filter((row) => row.customer.archivedAt === null)

  const overdue = active.filter((row) => row.nextAction.isOverdue)
  const dueToday = active.filter(
    (row) =>
      !row.nextAction.isOverdue &&
      row.nextAction.dueAt !== null &&
      isSameDay(new Date(row.nextAction.dueAt), now, settings.timeZone),
  )
  const noNextAction = active.filter((row) => row.nextAction.state === 'no_next_action')

  const selected = [...overdue, ...dueToday, ...noNextAction].slice(0, 15)

  // Nothing outstanding is worth staying silent about: a digest that says
  // "nothing" every morning trains you to ignore it, and costs a message.
  if (selected.length === 0) return null

  const heading = stage === 'morning_digest' ? 'DUE TODAY' : 'STILL OPEN TODAY'
  const lines = [`${heading} — ${selected.length}`, '']

  selected.forEach((row, index) => {
    lines.push(`${index + 1}. ${row.customer.fullName} — ${describeQueueState(row)}`)
  })

  lines.push('', 'Reply with a number to select a customer.')

  return {
    body: lines.join('\n'),
    summary: `${overdue.length} overdue, ${dueToday.length} due today, ${noNextAction.length} with no next action`,
  }
}

/** Confirmation sent after a command is applied. Deliberately compact. */
export function composeCommandConfirmation(customerName: string, changes: readonly string[]): string {
  return [`Updated ${customerName}`, '', ...changes.map((change) => `- ${change}`)].join('\n')
}

export function composeQueryResponse(title: string, rows: readonly CustomerRow[]): string {
  if (rows.length === 0) return `${title}\n\nNothing.`

  const lines = [`${title} — ${rows.length}`, '']
  rows.slice(0, 15).forEach((row, index) => {
    lines.push(`${index + 1}. ${row.customer.fullName} — ${describeQueueState(row)}`)
  })

  if (rows.length > 15) lines.push('', `…and ${rows.length - 15} more.`)

  return lines.join('\n')
}

function describeQueueState(row: CustomerRow): string {
  if (row.nextAction.state === 'no_next_action') return 'no next action'
  if (row.nextAction.dueAt === null) return row.nextAction.reason.toLowerCase()

  const dueMs = new Date(row.nextAction.dueAt).getTime()
  const lateMs = Date.now() - dueMs

  if (lateMs > 0) return `overdue ${describeDuration(lateMs)}`
  return `due ${formatRelative(row.nextAction.dueAt)}`
}

function describeLastAction(row: CustomerRow): string {
  if (row.lastActivity === null) return 'nothing recorded'

  const summary = row.lastActivity.summary ?? row.lastActivity.type.replace(/_/g, ' ')
  return `${summary} ${formatRelative(row.lastActivity.occurredAt)}`
}

function describeUnit(row: CustomerRow): string {
  const vehicle = row.primaryVehicle
  if (vehicle === null) return 'not specified'

  return (
    [vehicle.modelYear === null ? null : String(vehicle.modelYear), vehicle.make, vehicle.model]
      .filter((part): part is string => part !== null && part !== '')
      .join(' ') || 'not specified'
  )
}

function methodList(methods: readonly ContactMethod[]): string {
  if (methods.length === 0) return 'none'
  return methods.map((method) => CONTACT_METHOD_LABELS[method]).join(', ')
}

function describeDuration(ms: number): string {
  const hours = Math.floor(Math.abs(ms) / 3_600_000)
  if (hours < 1) return 'under an hour'
  if (hours < 48) return `${hours}h`

  return `${Math.floor(hours / 24)}d`
}

function isSameDay(a: Date, b: Date, timeZone: string): boolean {
  const format = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      date,
    )

  return format(a) === format(b)
}
