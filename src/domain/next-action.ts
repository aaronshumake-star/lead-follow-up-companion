/**
 * The rule the whole product exists to enforce: no active customer may be
 * without a next action.
 *
 * A customer is covered when it has reached a terminal status (sold, lost, do
 * not contact, archived) or has an open follow-up. Everything else is a lead
 * that can be forgotten, and belongs at the top of the dashboard.
 *
 * This mirrors the public.customer_next_action view so the client and the
 * database agree on what "covered" means.
 */

import type { Customer, FollowUp, IsoTimestamp } from './models.ts'
import { isClosedLeadStatus, isOpenFollowUpStatus } from './vocabulary.ts'

export const NEXT_ACTION_STATES = [
  'follow_up_scheduled',
  'waiting_on_customer',
  'appointment_scheduled',
  'sold',
  'lost',
  'do_not_contact',
  'archived',
  'no_next_action',
] as const
export type NextActionState = (typeof NEXT_ACTION_STATES)[number]

export interface NextAction {
  customerId: string
  state: NextActionState
  /** False only for 'no_next_action'; this is what the queue filters on. */
  hasNextAction: boolean
  isOverdue: boolean
  dueAt: IsoTimestamp | null
  openFollowUp: FollowUp | null
  /** Short, non-identifying explanation suitable for a badge or a digest line. */
  reason: string
}

/** The moment a follow-up actually comes back to the surface. */
export function effectiveDueAt(followUp: FollowUp): IsoTimestamp {
  if (followUp.status === 'snoozed' && followUp.snoozedUntil !== null) return followUp.snoozedUntil
  if (followUp.status === 'waiting_on_customer' && followUp.waitingUntil !== null) {
    return followUp.waitingUntil
  }
  return followUp.dueAt
}

export function findOpenFollowUp(followUps: readonly FollowUp[]): FollowUp | null {
  const open = followUps.filter((followUp) => isOpenFollowUpStatus(followUp.status))
  if (open.length === 0) return null

  // The schema permits only one open follow-up per customer; if data ever
  // disagrees, the earliest commitment is the one that matters.
  return open.reduce((earliest, candidate) =>
    effectiveDueAt(candidate) < effectiveDueAt(earliest) ? candidate : earliest,
  )
}

export function resolveNextAction(
  customer: Customer,
  followUps: readonly FollowUp[],
  now: Date = new Date(),
): NextAction {
  const openFollowUp = findOpenFollowUp(followUps)

  if (isClosedLeadStatus(customer.leadStatus)) {
    return {
      customerId: customer.id,
      state: customer.leadStatus as NextActionState,
      hasNextAction: true,
      isOverdue: false,
      dueAt: null,
      openFollowUp,
      reason: 'Closed: no follow-up required',
    }
  }

  if (openFollowUp === null) {
    return {
      customerId: customer.id,
      state: 'no_next_action',
      hasNextAction: false,
      isOverdue: false,
      dueAt: null,
      openFollowUp: null,
      reason: 'Active lead with nothing scheduled',
    }
  }

  const dueAt = effectiveDueAt(openFollowUp)
  const isOverdue = new Date(dueAt).getTime() <= now.getTime()

  // An appointment on the books is a stronger promise than a generic follow-up,
  // so it is reported as its own state.
  const state: NextActionState =
    customer.leadStatus === 'appointment_scheduled'
      ? 'appointment_scheduled'
      : openFollowUp.status === 'waiting_on_customer'
        ? 'waiting_on_customer'
        : 'follow_up_scheduled'

  return {
    customerId: customer.id,
    state,
    hasNextAction: true,
    isOverdue,
    dueAt,
    openFollowUp,
    reason:
      state === 'waiting_on_customer'
        ? isOverdue
          ? 'Waiting period elapsed'
          : 'Waiting for customer'
        : isOverdue
          ? 'Follow-up is overdue'
          : 'Follow-up scheduled',
  }
}

export interface QueueCounts {
  total: number
  noNextAction: number
  overdue: number
  dueToday: number
  waitingOnCustomer: number
  closed: number
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

/** The numbers behind the dashboard tiles and the WhatsApp morning summary. */
export function summarizeQueue(actions: readonly NextAction[], now: Date = new Date()): QueueCounts {
  const counts: QueueCounts = {
    total: actions.length,
    noNextAction: 0,
    overdue: 0,
    dueToday: 0,
    waitingOnCustomer: 0,
    closed: 0,
  }

  for (const action of actions) {
    if (!action.hasNextAction) {
      counts.noNextAction += 1
      continue
    }

    if (action.dueAt === null) {
      counts.closed += 1
      continue
    }

    if (action.state === 'waiting_on_customer') counts.waitingOnCustomer += 1
    if (action.isOverdue) counts.overdue += 1
    else if (isSameLocalDay(new Date(action.dueAt), now)) counts.dueToday += 1
  }

  return counts
}

/**
 * Orders the work queue: forgotten leads first, then overdue, then by due time.
 * Deliberately not sorted by priority alone — a forgotten lead is a process
 * failure and outranks a scheduled urgent one that is already handled.
 */
export function sortByUrgency(actions: readonly NextAction[]): NextAction[] {
  return [...actions].sort((a, b) => {
    if (a.hasNextAction !== b.hasNextAction) return a.hasNextAction ? 1 : -1
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1

    if (a.dueAt === null && b.dueAt === null) return 0
    if (a.dueAt === null) return 1
    if (b.dueAt === null) return -1

    return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0
  })
}
