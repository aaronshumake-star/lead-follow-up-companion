/**
 * The dashboard read model.
 *
 * One pass over the working set produces every queue and every count, so the
 * numbers in the tiles and the rows in the lists can never disagree.
 *
 * The rule that shapes all of it: **an overdue lead stays visible until the
 * action is resolved.** Nothing here filters on "today" in a way that would let
 * a lead fall out of sight because the calendar rolled over. A follow-up leaves
 * these queues only by being completed, rescheduled, canceled, or by the
 * customer reaching a closed status.
 */

import type {
  Activity,
  Customer,
  CustomerContactMethod,
  FollowUp,
  IsoTimestamp,
  VehicleInterest,
} from './models.ts'
import { summarizeContactMethods, type ContactMethodSummary } from './contact-methods.ts'
import { effectiveDueAt, findOpenFollowUp, resolveNextAction, type NextAction } from './next-action.ts'
import { isClosedLeadStatus } from './vocabulary.ts'
import { isSameZonedDay, zonedDayDifference } from '../lib/time-zone.ts'

/** How far ahead counts as "act on this now" rather than "later today". */
export const ACTION_WINDOW_HOURS = 2

export const DASHBOARD_QUEUES = [
  'action_required',
  'overdue',
  'due_today',
  'due_tomorrow',
  'waiting_for_customer',
  'no_next_action',
  'upcoming_appointments',
  'recently_added',
] as const
export type DashboardQueueId = (typeof DASHBOARD_QUEUES)[number]

export const DASHBOARD_QUEUE_LABELS: Record<DashboardQueueId, string> = {
  action_required: 'Action required now',
  overdue: 'Overdue',
  due_today: 'Due today',
  due_tomorrow: 'Due tomorrow',
  waiting_for_customer: 'Waiting for customer',
  no_next_action: 'No next action',
  upcoming_appointments: 'Upcoming appointments',
  recently_added: 'Recently added',
}

/**
 * Everything the dashboard and the customer card need about one customer,
 * assembled once so no component has to re-derive it.
 */
export interface CustomerRow {
  customer: Customer
  nextAction: NextAction
  openFollowUp: FollowUp | null
  /** Every follow-up this customer has ever had, newest commitment first. */
  followUpHistory: FollowUp[]
  coverage: ContactMethodSummary
  contactMethods: CustomerContactMethod[]
  vehicleInterests: VehicleInterest[]
  /** The unit the customer is actually shopping for, when one is marked. */
  primaryVehicle: VehicleInterest | null
  activities: Activity[]
  lastActivity: Activity | null
  /** Milliseconds since the last activity of any kind, null when there is none. */
  msSinceLastActivity: number | null
  /** Milliseconds spent waiting on a response, null when not waiting. */
  msWaiting: number | null
}

export interface DashboardCounts {
  actionRequired: number
  overdue: number
  dueToday: number
  dueTomorrow: number
  waitingForCustomer: number
  noNextAction: number
  upcomingAppointments: number
  needsReview: number
}

export interface Dashboard {
  counts: DashboardCounts
  actionRequired: CustomerRow[]
  overdue: CustomerRow[]
  dueToday: CustomerRow[]
  dueTomorrow: CustomerRow[]
  waitingForCustomer: CustomerRow[]
  noNextAction: CustomerRow[]
  upcomingAppointments: CustomerRow[]
  recentlyAdded: CustomerRow[]
  /** Every non-archived customer, for pages that want the whole working set. */
  rows: CustomerRow[]
}

export interface DashboardInput {
  customers: readonly Customer[]
  contactMethods: readonly CustomerContactMethod[]
  vehicleInterests: readonly VehicleInterest[]
  activities: readonly Activity[]
  followUps: readonly FollowUp[]
  timeZone: string
  now?: Date
}

/** Assembles one row per customer, including archived ones. */
export function buildCustomerRows(input: DashboardInput): CustomerRow[] {
  const now = input.now ?? new Date()

  const methodsByCustomer = groupBy(input.contactMethods, (item) => item.customerId)
  const vehiclesByCustomer = groupBy(input.vehicleInterests, (item) => item.customerId)
  const activitiesByCustomer = groupBy(input.activities, (item) => item.customerId)
  const followUpsByCustomer = groupBy(input.followUps, (item) => item.customerId)

  return input.customers.map((customer) => {
    const activities = [...(activitiesByCustomer.get(customer.id) ?? [])].sort((a, b) =>
      compareIso(b.occurredAt, a.occurredAt),
    )
    const followUps = followUpsByCustomer.get(customer.id) ?? []
    const openFollowUp = findOpenFollowUp(followUps)
    const contactMethods = methodsByCustomer.get(customer.id) ?? []
    const vehicleInterests = vehiclesByCustomer.get(customer.id) ?? []

    const lastActivity = activities[0] ?? null

    const waitingSince =
      openFollowUp !== null && openFollowUp.status === 'waiting_on_customer'
        ? lastOutboundAt(activities)
        : null

    return {
      customer,
      nextAction: resolveNextAction(customer, followUps, now),
      openFollowUp,
      followUpHistory: [...followUps].sort((a, b) => compareIso(b.createdAt, a.createdAt)),
      coverage: summarizeContactMethods(contactMethods, activities),
      contactMethods,
      vehicleInterests,
      primaryVehicle: vehicleInterests.find((item) => item.isPrimary) ?? vehicleInterests[0] ?? null,
      activities,
      lastActivity,
      msSinceLastActivity:
        lastActivity === null ? null : now.getTime() - new Date(lastActivity.occurredAt).getTime(),
      msWaiting: waitingSince === null ? null : now.getTime() - new Date(waitingSince).getTime(),
    }
  })
}

export function buildDashboard(input: DashboardInput): Dashboard {
  const now = input.now ?? new Date()
  const timeZone = input.timeZone
  const allRows = buildCustomerRows(input)

  // Archived customers are excluded from every working queue, but their rows are
  // still built so the customer list can show them on request.
  const rows = allRows.filter((row) => row.customer.archivedAt === null)

  const withOpenFollowUp = rows.filter((row) => row.openFollowUp !== null)

  const overdue = withOpenFollowUp
    .filter((row) => isPast(dueAtOf(row), now))
    // Most overdue first: the longest-neglected lead is the most urgent.
    .sort((a, b) => compareIso(dueAtOf(a), dueAtOf(b)))

  const waitingExpired = withOpenFollowUp.filter(
    (row) =>
      row.openFollowUp?.status === 'waiting_on_customer' &&
      row.openFollowUp.waitingUntil !== null &&
      isPast(row.openFollowUp.waitingUntil, now),
  )

  const dueSoon = withOpenFollowUp.filter((row) => {
    const dueAt = dueAtOf(row)
    if (isPast(dueAt, now)) return false
    return new Date(dueAt).getTime() - now.getTime() <= ACTION_WINDOW_HOURS * 3_600_000
  })

  // A lapsed waiting deadline is already overdue, so union rather than concat.
  const actionRequired = uniqueRows([...overdue, ...dueSoon, ...waitingExpired]).sort((a, b) =>
    compareIso(dueAtOf(a), dueAtOf(b)),
  )

  const dueToday = withOpenFollowUp
    .filter((row) => {
      const dueAt = dueAtOf(row)
      if (isPast(dueAt, now)) return false
      return isSameZonedDay(new Date(dueAt), now, timeZone)
    })
    .sort((a, b) => compareIso(dueAtOf(a), dueAtOf(b)))

  const dueTomorrow = withOpenFollowUp
    .filter((row) => zonedDayDifference(now, new Date(dueAtOf(row)), timeZone) === 1)
    .sort((a, b) => compareIso(dueAtOf(a), dueAtOf(b)))

  const waitingForCustomer = withOpenFollowUp
    .filter((row) => row.openFollowUp?.status === 'waiting_on_customer')
    .sort((a, b) => compareIso(row2Waiting(a), row2Waiting(b)))

  const noNextAction = rows
    .filter((row) => row.nextAction.state === 'no_next_action')
    // Longest untouched first: those are the ones actually going cold.
    .sort((a, b) => (b.msSinceLastActivity ?? Number.MAX_SAFE_INTEGER) - (a.msSinceLastActivity ?? Number.MAX_SAFE_INTEGER))

  const upcomingAppointments = withOpenFollowUp
    .filter((row) => row.openFollowUp?.isAppointment === true && !isPast(dueAtOf(row), now))
    .sort((a, b) => compareIso(dueAtOf(a), dueAtOf(b)))

  const recentlyAdded = [...rows]
    .sort((a, b) => compareIso(b.customer.createdAt, a.customer.createdAt))
    .slice(0, 8)

  // "Needs review" is anything the operator has not looked at properly: an
  // active lead with no next action, or one imported from a screenshot that has
  // never been touched by hand.
  const needsReview = rows.filter(
    (row) =>
      !isClosedLeadStatus(row.customer.leadStatus) &&
      (row.nextAction.state === 'no_next_action' ||
        (row.customer.source === 'screenshot' && row.coverage.totalAttempts === 0)),
  )

  return {
    counts: {
      actionRequired: actionRequired.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      dueTomorrow: dueTomorrow.length,
      waitingForCustomer: waitingForCustomer.length,
      noNextAction: noNextAction.length,
      upcomingAppointments: upcomingAppointments.length,
      needsReview: needsReview.length,
    },
    actionRequired,
    overdue,
    dueToday,
    dueTomorrow,
    waitingForCustomer,
    noNextAction,
    upcomingAppointments,
    recentlyAdded,
    rows: allRows,
  }
}

function dueAtOf(row: CustomerRow): IsoTimestamp {
  return row.openFollowUp === null ? new Date(0).toISOString() : effectiveDueAt(row.openFollowUp)
}

function row2Waiting(row: CustomerRow): IsoTimestamp {
  return row.openFollowUp?.waitingUntil ?? dueAtOf(row)
}

function lastOutboundAt(activities: readonly Activity[]): IsoTimestamp | null {
  return activities.reduce<IsoTimestamp | null>((latest, activity) => {
    if (activity.direction !== 'outbound') return latest
    return latest === null || activity.occurredAt > latest ? activity.occurredAt : latest
  }, null)
}

function isPast(iso: IsoTimestamp, now: Date): boolean {
  return new Date(iso).getTime() <= now.getTime()
}

function compareIso(a: IsoTimestamp, b: IsoTimestamp): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function uniqueRows(rows: readonly CustomerRow[]): CustomerRow[] {
  const seen = new Set<string>()
  const result: CustomerRow[] = []

  for (const row of rows) {
    if (seen.has(row.customer.id)) continue
    seen.add(row.customer.id)
    result.push(row)
  }

  return result
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()

  for (const item of items) {
    const id = key(item)
    const existing = map.get(id)
    if (existing === undefined) map.set(id, [item])
    else existing.push(item)
  }

  return map
}
