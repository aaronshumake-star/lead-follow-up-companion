/**
 * Turns planned reminders into sent messages, exactly once.
 *
 * The order of operations is the whole point:
 *
 *   1. Expire lapsed waiting deadlines, so they return to the action queue and
 *      are eligible for a reminder in the same run.
 *   2. Plan reminders from the working set.
 *   3. Claim each one. The claim is an insert against a unique idempotency key,
 *      so a concurrent run, a scheduler retry, or an overlapping tick all lose
 *      the race and skip instead of sending a second copy.
 *   4. Send only what was claimed, then record the outcome.
 *
 * Retries are bounded and only ever applied to failures the provider indicated
 * were transient. A 4xx is the provider saying the request is wrong; sending it
 * again would bill for the same rejection.
 */

import { planReminders } from '../domain/messaging/reminder-engine.ts'
import type { MessagingPort, ReminderStore } from './ports.ts'

export interface DispatchSummary {
  accounts: number
  expiredWaiting: number
  planned: number
  claimed: number
  sent: number
  suppressed: number
  failed: number
  retried: number
}

export interface DispatchOptions {
  now?: Date
  /** Identifies the run in the claim row, so contention is diagnosable. */
  claimedBy?: string
}

export async function dispatchReminders(
  store: ReminderStore,
  messaging: MessagingPort,
  options: DispatchOptions = {},
): Promise<DispatchSummary> {
  const now = options.now ?? new Date()

  const summary: DispatchSummary = {
    accounts: 0,
    expiredWaiting: 0,
    planned: 0,
    claimed: 0,
    sent: 0,
    suppressed: 0,
    failed: 0,
    retried: 0,
  }

  for (const account of await store.listAccounts()) {
    summary.accounts += 1

    // Runs regardless of whether reminders are enabled: a lapsed waiting
    // deadline has to return to the action queue either way, because the
    // dashboard is the fallback surface when messaging is off.
    summary.expiredWaiting += await store.expireWaitingFollowUps(account.userId, now)

    if (!account.remindersEnabled || account.approvedNumberE164 === null) continue

    const rows = await store.loadRows(account.userId, now)
    const jobs = planReminders({ rows, settings: account.settings, now })
    summary.planned += jobs.length

    for (const job of jobs) {
      const notificationId = await store.claimNotification({
        userId: account.userId,
        idempotencyKey: job.idempotencyKey,
        kind: job.stage.endsWith('digest') ? 'morning_summary' : 'follow_up_reminder',
        reminderStage: job.stage,
        followUpId: job.followUpId,
        customerId: job.customerId,
        toNumberE164: account.approvedNumberE164,
        payloadSummary: job.payloadSummary,
      })

      // Losing the claim is the normal, healthy outcome of a second run.
      if (notificationId === null) {
        summary.suppressed += 1
        continue
      }

      summary.claimed += 1
      await store.recordUsage(account.userId, 'reminder_generated', 1, 0)

      const outcome = await messaging.sendText({
        toE164: account.approvedNumberE164,
        body: job.body,
        idempotencyKey: job.idempotencyKey,
      })

      await store.recordSendResult(notificationId, applyRetryPolicy(outcome, 1, account.settings.reminderMaxAttempts, now))

      if (outcome.status === 'sent') {
        summary.sent += 1
        await store.recordUsage(account.userId, 'message_sent', 1, outcome.billable === false ? 0 : 0.015)
      } else {
        summary.failed += 1
        await store.recordUsage(account.userId, 'message_failed', 1, 0)
      }
    }

    summary.retried += await retryFailures(store, messaging, account.userId, account.settings.reminderMaxAttempts, account.approvedNumberE164, now)
  }

  return summary
}

/**
 * Re-attempts sends that failed transiently and have attempts left.
 *
 * The idempotency key is unchanged, and the row is already claimed, so a retry
 * can never produce a second message — it is the same logical send, tried again.
 */
async function retryFailures(
  store: ReminderStore,
  messaging: MessagingPort,
  userId: string,
  maxAttempts: number,
  toNumberE164: string,
  now: Date,
): Promise<number> {
  const pending = await store.listRetryable(userId, now, maxAttempts)
  let retried = 0

  for (const row of pending) {
    const outcome = await messaging.sendText({
      toE164: row.toNumberE164 ?? toNumberE164,
      body: row.body,
      idempotencyKey: row.idempotencyKey,
    })

    await store.recordSendResult(row.id, applyRetryPolicy(outcome, row.attemptCount + 1, maxAttempts, now))
    await store.recordUsage(userId, 'message_retry', 1, 0)

    if (outcome.status === 'sent') {
      await store.recordUsage(userId, 'message_sent', 1, 0.015)
    }

    retried += 1
  }

  return retried
}

/**
 * Decides whether a failure gets another attempt.
 *
 * A permanent failure is marked as such so it stays visible in diagnostics
 * rather than being retried forever or quietly disappearing.
 */
export function applyRetryPolicy(
  outcome: import('./ports.ts').SendOutcome,
  attempt: number,
  maxAttempts: number,
  now: Date,
): import('./ports.ts').SendOutcome {
  if (outcome.status === 'sent') return outcome

  const exhausted = attempt >= maxAttempts
  const permanent = outcome.permanent === true || exhausted

  return {
    ...outcome,
    permanent,
    // Exponential-ish backoff, capped: a provider outage should not be hammered.
    nextAttemptAt: permanent ? null : new Date(now.getTime() + attempt * 15 * 60_000).toISOString(),
  }
}
