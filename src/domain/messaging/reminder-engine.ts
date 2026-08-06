/**
 * The reminder engine.
 *
 * Planning is a pure function of the working set, the settings and the clock,
 * so every reminder rule is testable without a scheduler, a database or a
 * provider. The transport is somebody else's problem: this decides *what*
 * should be sent, and the caller decides how.
 *
 * The correction from the brief shapes the whole design. The
 * one-open-follow-up index stops duplicate follow-up *records*; it does nothing
 * about duplicate *sends*. Every job therefore carries an idempotency key that
 * pins the message to a follow-up, a stage and a due time — so a scheduler
 * retry, a concurrent run, or a second tick within the same window all produce
 * the same key and collide on the unique index instead of sending twice.
 */

import type { CustomerRow } from '../dashboard.ts'
import type { ReminderStage } from '../models.ts'
import type { UserSettings } from '../settings.ts'
import { effectiveDueAt } from '../next-action.ts'
import { atZonedTime, zonedDateKey, zonedPartsOf } from '../../lib/time-zone.ts'
import { composeAppointmentReminder, composeDigest, composeIndividualReminder, composeWaitingReminder } from './messages.ts'

export interface ReminderJob {
  stage: ReminderStage
  /** Deterministic. Two runs producing this key must never both send. */
  idempotencyKey: string
  body: string
  customerId: string | null
  followUpId: string | null
  /** Short, identifier-light line stored on the notification row. */
  payloadSummary: string
}

export interface ReminderPlanInput {
  rows: readonly CustomerRow[]
  settings: UserSettings
  now?: Date
  /**
   * Keys already claimed. Passed in rather than queried so planning stays pure;
   * the store still enforces uniqueness, this only avoids pointless work.
   */
  sentKeys?: ReadonlySet<string>
}

/** How close to due counts as "due now" rather than "still ahead". */
const DUE_WINDOW_MINUTES = 15

/** Digests fire within this many minutes of their configured time. */
const DIGEST_WINDOW_MINUTES = 30

export function planReminders(input: ReminderPlanInput): ReminderJob[] {
  const now = input.now ?? new Date()
  const { settings } = input
  const sent = input.sentKeys ?? new Set<string>()

  // The master switch. With reminders off the dashboard remains the surface,
  // which is the same degraded path a provider outage produces.
  if (!settings.remindersEnabled) return []

  const jobs: ReminderJob[] = []
  const dateKey = zonedDateKey(now, settings.timeZone)

  const active = input.rows.filter((row) => row.customer.archivedAt === null)

  // --- digests --------------------------------------------------------------
  if (settings.morningDigestEnabled && isWithinWindow(now, settings.timeZone, settings.morningAt)) {
    const job = buildDigestJob('morning_digest', active, settings, now, dateKey)
    if (job !== null) jobs.push(job)
  }

  if (
    settings.endOfDayDigestEnabled &&
    isWithinWindow(now, settings.timeZone, settings.endOfDayDigestAt)
  ) {
    const job = buildDigestJob('end_of_day_digest', active, settings, now, dateKey)
    if (job !== null) jobs.push(job)
  }

  // Digest-only mode exists so a heavy day costs two messages instead of twenty.
  if (settings.digestOnly || !settings.individualRemindersEnabled) {
    return jobs.filter((job) => !sent.has(job.idempotencyKey))
  }

  // --- individual reminders --------------------------------------------------
  for (const row of active) {
    const followUp = row.openFollowUp
    if (followUp === null) continue

    // A completed or canceled follow-up is not open, so it never reaches here —
    // that is what stops a resolved item being chased.
    const dueAt = effectiveDueAt(followUp)
    const dueMs = new Date(dueAt).getTime()

    if (followUp.isAppointment) {
      const leadMs = settings.appointmentReminderLeadHours * 3_600_000
      if (dueMs - now.getTime() <= leadMs && dueMs > now.getTime()) {
        jobs.push({
          stage: 'appointment',
          // Pinned to the due time, so rescheduling produces a different key
          // and the new time is reminded about rather than the old one.
          idempotencyKey: reminderKey('appointment', followUp.id, dueAt),
          body: composeAppointmentReminder(row, settings),
          customerId: row.customer.id,
          followUpId: followUp.id,
          payloadSummary: `Appointment: ${row.customer.fullName}`,
        })
      }
      continue
    }

    if (followUp.status === 'waiting_on_customer') {
      const waitingUntil = followUp.waitingUntil
      if (waitingUntil !== null && new Date(waitingUntil).getTime() <= now.getTime()) {
        jobs.push({
          stage: 'waiting_deadline',
          idempotencyKey: reminderKey('waiting_deadline', followUp.id, waitingUntil),
          body: composeWaitingReminder(row, settings),
          customerId: row.customer.id,
          followUpId: followUp.id,
          payloadSummary: `Waiting elapsed: ${row.customer.fullName}`,
        })
      }
      continue
    }

    const minutesLate = (now.getTime() - dueMs) / 60_000
    if (minutesLate < -DUE_WINDOW_MINUTES) continue

    if (minutesLate <= settings.overdueReminderIntervalHours * 60) {
      jobs.push({
        stage: 'due_now',
        idempotencyKey: reminderKey('due_now', followUp.id, dueAt),
        body: composeIndividualReminder(row, settings),
        customerId: row.customer.id,
        followUpId: followUp.id,
        payloadSummary: `Due: ${row.customer.fullName}`,
      })
      continue
    }

    // Chased at a configured interval rather than every tick, so a lead that
    // stays overdue for a week does not generate a week of messages.
    const bucket = Math.floor(minutesLate / (settings.overdueReminderIntervalHours * 60))
    jobs.push({
      stage: 'overdue',
      idempotencyKey: reminderKey('overdue', followUp.id, `${dueAt}:${bucket}`),
      body: composeIndividualReminder(row, settings),
      customerId: row.customer.id,
      followUpId: followUp.id,
      payloadSummary: `Overdue: ${row.customer.fullName}`,
    })
  }

  return jobs.filter((job) => !sent.has(job.idempotencyKey))
}

function buildDigestJob(
  stage: 'morning_digest' | 'end_of_day_digest',
  rows: readonly CustomerRow[],
  settings: UserSettings,
  now: Date,
  dateKey: string,
): ReminderJob | null {
  const composed = composeDigest(stage, rows, settings, now)
  if (composed === null) return null

  return {
    stage,
    // One digest per day per kind, whatever happens to the scheduler.
    idempotencyKey: `${stage}:${dateKey}`,
    body: composed.body,
    customerId: null,
    followUpId: null,
    payloadSummary: composed.summary,
  }
}

/**
 * Builds a reminder's idempotency key.
 *
 * The due time is part of the key on purpose: rescheduling a follow-up produces
 * a different key, so the new time gets its own reminder while the old one can
 * never fire again.
 */
export function reminderKey(stage: ReminderStage, followUpId: string, dueAt: string): string {
  return `${stage}:${followUpId}:${dueAt}`
}

function isWithinWindow(now: Date, timeZone: string, wallClock: string): boolean {
  const target = atZonedTime(now, timeZone, 0, wallClock)
  const diffMinutes = (now.getTime() - target.getTime()) / 60_000

  return diffMinutes >= 0 && diffMinutes <= DIGEST_WINDOW_MINUTES
}

/** Exposed for tests and diagnostics: what hour the operator's clock reads. */
export function localHour(now: Date, timeZone: string): number {
  return zonedPartsOf(now, timeZone).hour
}
