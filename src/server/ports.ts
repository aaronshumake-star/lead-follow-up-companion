/**
 * The narrow interfaces the scheduler and webhook depend on.
 *
 * Everything server-side is written against these rather than against Supabase
 * or the Cloud API directly, so the dispatcher and the router can be tested
 * with in-memory fakes and no network, and the Cloudflare Worker becomes thin
 * glue rather than the place the logic lives.
 */

import type { CustomerRow } from '../domain/dashboard.ts'
import type { ReminderStage } from '../domain/models.ts'
import type { UserSettings } from '../domain/settings.ts'
import type { CommandEffect } from '../domain/messaging/command-executor.ts'

export interface AccountContext {
  userId: string
  settings: UserSettings
  /** The only number that may be messaged, or may send commands. */
  approvedNumberE164: string | null
  remindersEnabled: boolean
}

export interface ClaimRequest {
  userId: string
  idempotencyKey: string
  kind: 'follow_up_reminder' | 'morning_summary' | 'overdue_summary' | 'command_confirmation' | 'command_error'
  reminderStage: ReminderStage | null
  followUpId: string | null
  customerId: string | null
  toNumberE164: string | null
  payloadSummary: string
}

export interface SendOutcome {
  status: 'sent' | 'failed'
  providerMessageId?: string
  billable?: boolean
  error?: string
  permanent?: boolean
  nextAttemptAt?: string | null
}

/**
 * Storage for the scheduler and webhook.
 *
 * `claimNotification` is the important one: it must return null when the key is
 * already taken, which is what makes concurrent runs safe.
 */
export interface ReminderStore {
  listAccounts(): Promise<AccountContext[]>
  loadRows(userId: string, now: Date): Promise<CustomerRow[]>
  /** Returns lapsed waiting follow-ups to the action queue. Idempotent. */
  expireWaitingFollowUps(userId: string, now: Date): Promise<number>
  /** Returns the notification id, or null when another run already owns it. */
  claimNotification(request: ClaimRequest): Promise<string | null>
  recordSendResult(notificationId: string, outcome: SendOutcome): Promise<void>
  /** Rows that failed with a retryable error and are due another attempt. */
  listRetryable(userId: string, now: Date, maxAttempts: number): Promise<
    Array<{ id: string; idempotencyKey: string; body: string; toNumberE164: string | null; attemptCount: number }>
  >
  recordUsage(userId: string, kind: 'message_sent' | 'message_received' | 'message_failed' | 'message_retry' | 'reminder_generated', quantity: number, costUsd: number): Promise<void>
}

export interface WebhookStore extends ReminderStore {
  /** False when this provider message id has already been handled. */
  registerInboundMessage(input: {
    userId: string | null
    providerMessageId: string
    fromE164: string
    isApprovedSender: boolean
    text: string | null
  }): Promise<boolean>
  updateDeliveryStatus(providerMessageId: string, status: string, error?: string | null): Promise<void>
  readOpenClarification(userId: string, now: Date): Promise<{
    id: string
    options: Array<{ label: string; value: string }>
    pendingPayload: Record<string, unknown>
  } | null>
  openClarification(input: {
    userId: string
    kind: string
    prompt: string
    options: Array<{ label: string; value: string }>
    pendingPayload: Record<string, unknown>
    expiresAt: string
  }): Promise<void>
  resolveClarification(sessionId: string, resolution: string): Promise<void>
  applyCommandEffects(userId: string, customerId: string, effects: readonly CommandEffect[], now: Date): Promise<void>
  writeAudit(userId: string, summary: string, metadata: Record<string, unknown>): Promise<void>
  /** Customers with a recent reminder, used to attach an unaddressed quick reply. */
  recentReminderCustomerIds(userId: string): Promise<string[]>
}

export interface MessagingPort {
  sendText(input: { toE164: string; body: string; idempotencyKey: string }): Promise<SendOutcome>
}
