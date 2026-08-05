/**
 * In-memory implementation of the server ports, for tests.
 *
 * It reproduces the behaviours that matter rather than approximating them: the
 * claim really is unique-keyed, duplicate provider message ids really are
 * rejected, and there really is only one open clarification at a time. A test
 * that passes against this is testing the same rules the database enforces.
 */

import type { CustomerRow } from '../domain/dashboard.ts'
import { buildCustomerRows } from '../domain/dashboard.ts'
import type { Activity, Customer, CustomerContactMethod, FollowUp, VehicleInterest } from '../domain/models.ts'
import type { UserSettings } from '../domain/settings.ts'
import { DEFAULT_SETTINGS } from '../domain/settings.ts'
import { isOpenFollowUpStatus } from '../domain/vocabulary.ts'
import type { CommandEffect } from '../domain/messaging/command-executor.ts'
import type {
  AccountContext,
  ClaimRequest,
  MessagingPort,
  SendOutcome,
  WebhookStore,
} from './ports.ts'

export interface MemoryStoreSeed {
  userId?: string
  settings?: Partial<UserSettings>
  approvedNumberE164?: string | null
  remindersEnabled?: boolean
  customers?: Customer[]
  contactMethods?: CustomerContactMethod[]
  vehicleInterests?: VehicleInterest[]
  activities?: Activity[]
  followUps?: FollowUp[]
}

export interface StoredNotification {
  id: string
  userId: string
  idempotencyKey: string
  status: 'queued' | 'sent' | 'failed'
  attemptCount: number
  permanentFailure: boolean
  nextAttemptAt: string | null
  body: string
  toNumberE164: string | null
  error: string | null
  providerMessageId: string | null
}

export class MemoryStore implements WebhookStore {
  readonly userId: string
  settings: UserSettings
  approvedNumberE164: string | null
  remindersEnabled: boolean

  customers: Customer[]
  contactMethods: CustomerContactMethod[]
  vehicleInterests: VehicleInterest[]
  activities: Activity[]
  followUps: FollowUp[]

  readonly notifications: StoredNotification[] = []
  readonly inboundMessageIds = new Set<string>()
  readonly auditEntries: Array<{ summary: string; metadata: Record<string, unknown> }> = []
  readonly usage: Array<{ kind: string; quantity: number; costUsd: number }> = []
  readonly appliedEffects: Array<{ customerId: string; effects: CommandEffect[] }> = []
  clarification: {
    id: string
    options: Array<{ label: string; value: string }>
    pendingPayload: Record<string, unknown>
    expiresAt: string
    resolvedAt: string | null
  } | null = null

  private counter = 0

  constructor(seed: MemoryStoreSeed = {}) {
    this.userId = seed.userId ?? 'user-1'
    this.settings = { ...DEFAULT_SETTINGS, ...seed.settings }
    this.approvedNumberE164 = seed.approvedNumberE164 === undefined ? '+15550100999' : seed.approvedNumberE164
    this.remindersEnabled = seed.remindersEnabled ?? true
    this.customers = seed.customers ?? []
    this.contactMethods = seed.contactMethods ?? []
    this.vehicleInterests = seed.vehicleInterests ?? []
    this.activities = seed.activities ?? []
    this.followUps = seed.followUps ?? []
  }

  async listAccounts(): Promise<AccountContext[]> {
    return [
      {
        userId: this.userId,
        settings: this.settings,
        approvedNumberE164: this.approvedNumberE164,
        remindersEnabled: this.remindersEnabled,
      },
    ]
  }

  async loadRows(_userId: string, now: Date): Promise<CustomerRow[]> {
    return buildCustomerRows({
      customers: this.customers,
      contactMethods: this.contactMethods,
      vehicleInterests: this.vehicleInterests,
      activities: this.activities,
      followUps: this.followUps,
      timeZone: this.settings.timeZone,
      now,
    })
  }

  async expireWaitingFollowUps(_userId: string, now: Date): Promise<number> {
    let expired = 0

    for (const followUp of this.followUps) {
      if (followUp.status !== 'waiting_on_customer') continue
      if (followUp.waitingUntil === null) continue
      if (new Date(followUp.waitingUntil).getTime() > now.getTime()) continue

      followUp.status = 'overdue'
      followUp.dueAt = followUp.waitingUntil < followUp.dueAt ? followUp.waitingUntil : followUp.dueAt
      followUp.waitingUntil = null
      expired += 1
    }

    return expired
  }

  /** The unique-key claim. Returns null when the key is already taken. */
  async claimNotification(request: ClaimRequest): Promise<string | null> {
    const existing = this.notifications.find(
      (entry) => entry.userId === request.userId && entry.idempotencyKey === request.idempotencyKey,
    )
    if (existing !== undefined) return null

    this.counter += 1
    const id = `n-${this.counter}`

    this.notifications.push({
      id,
      userId: request.userId,
      idempotencyKey: request.idempotencyKey,
      status: 'queued',
      attemptCount: 0,
      permanentFailure: false,
      nextAttemptAt: null,
      body: request.payloadSummary,
      toNumberE164: request.toNumberE164,
      error: null,
      providerMessageId: null,
    })

    return id
  }

  async recordSendResult(notificationId: string, outcome: SendOutcome): Promise<void> {
    const entry = this.notifications.find((item) => item.id === notificationId)
    if (entry === undefined) return

    entry.status = outcome.status
    entry.attemptCount = Math.min(entry.attemptCount + 1, 3)
    entry.permanentFailure = outcome.permanent === true
    entry.nextAttemptAt = outcome.nextAttemptAt ?? null
    entry.error = outcome.error ?? null
    entry.providerMessageId = outcome.providerMessageId ?? entry.providerMessageId
  }

  async listRetryable(
    userId: string,
    now: Date,
    maxAttempts: number,
  ): Promise<Array<{ id: string; idempotencyKey: string; body: string; toNumberE164: string | null; attemptCount: number }>> {
    return this.notifications
      .filter(
        (entry) =>
          entry.userId === userId &&
          entry.status === 'failed' &&
          !entry.permanentFailure &&
          entry.attemptCount < maxAttempts &&
          entry.nextAttemptAt !== null &&
          new Date(entry.nextAttemptAt).getTime() <= now.getTime(),
      )
      .map((entry) => ({
        id: entry.id,
        idempotencyKey: entry.idempotencyKey,
        body: entry.body,
        toNumberE164: entry.toNumberE164,
        attemptCount: entry.attemptCount,
      }))
  }

  async recordUsage(
    _userId: string,
    kind: 'message_sent' | 'message_received' | 'message_failed' | 'message_retry' | 'reminder_generated',
    quantity: number,
    costUsd: number,
  ): Promise<void> {
    this.usage.push({ kind, quantity, costUsd })
  }

  /** False on a repeat, which is what makes webhook retries safe. */
  async registerInboundMessage(input: {
    providerMessageId: string
    fromE164: string
    isApprovedSender: boolean
  }): Promise<boolean> {
    if (this.inboundMessageIds.has(input.providerMessageId)) return false

    this.inboundMessageIds.add(input.providerMessageId)
    return true
  }

  async updateDeliveryStatus(providerMessageId: string, status: string, error?: string | null): Promise<void> {
    const entry = this.notifications.find((item) => item.providerMessageId === providerMessageId)
    if (entry === undefined) return

    if (status === 'failed') {
      entry.status = 'failed'
      entry.error = error ?? 'Delivery failed'
    }
  }

  async readOpenClarification(_userId: string, now: Date) {
    if (this.clarification === null) return null
    if (this.clarification.resolvedAt !== null) return null
    if (new Date(this.clarification.expiresAt).getTime() <= now.getTime()) return null

    return {
      id: this.clarification.id,
      options: this.clarification.options,
      pendingPayload: this.clarification.pendingPayload,
    }
  }

  async openClarification(input: {
    kind: string
    prompt: string
    options: Array<{ label: string; value: string }>
    pendingPayload: Record<string, unknown>
    expiresAt: string
  }): Promise<void> {
    this.counter += 1
    // One open question at a time, matching the partial unique index.
    this.clarification = {
      id: `c-${this.counter}`,
      options: input.options,
      pendingPayload: input.pendingPayload,
      expiresAt: input.expiresAt,
      resolvedAt: null,
    }
  }

  async resolveClarification(sessionId: string, _resolution: string): Promise<void> {
    if (this.clarification?.id === sessionId) {
      this.clarification.resolvedAt = new Date().toISOString()
    }
  }

  async applyCommandEffects(
    _userId: string,
    customerId: string,
    effects: readonly CommandEffect[],
    now: Date,
  ): Promise<void> {
    this.appliedEffects.push({ customerId, effects: [...effects] })

    for (const effect of effects) {
      if (effect.type === 'log_activity') {
        this.counter += 1
        this.activities.push({
          id: `a-${this.counter}`,
          customerId,
          type: effect.activityType,
          direction: effect.direction,
          method: effect.method,
          outcome: effect.outcome,
          summary: effect.summary,
          rawText: null,
          occurredAt: now.toISOString(),
          source: 'whatsapp',
          performedByUser: effect.direction === 'outbound',
          externalMessageId: null,
        })
      }

      if (effect.type === 'complete_follow_up') {
        const open = this.followUps.find(
          (item) => item.customerId === customerId && isOpenFollowUpStatus(item.status),
        )
        if (open !== undefined) {
          open.status = 'completed'
          open.completedAt = now.toISOString()
        }
      }

      if (effect.type === 'set_status') {
        const customer = this.customers.find((item) => item.id === customerId)
        if (customer !== undefined) customer.leadStatus = effect.status
      }
    }
  }

  async writeAudit(_userId: string, summary: string, metadata: Record<string, unknown>): Promise<void> {
    this.auditEntries.push({ summary, metadata })
  }

  async recentReminderCustomerIds(): Promise<string[]> {
    return []
  }
}

/** A messaging port that records instead of sending, with injectable failures. */
export class MemoryMessaging implements MessagingPort {
  readonly sent: Array<{ toE164: string; body: string; idempotencyKey: string }> = []
  private failures: SendOutcome[] = []
  private counter = 0

  queueFailure(outcome: Partial<SendOutcome> = {}): void {
    this.failures.push({ status: 'failed', error: 'Simulated failure', permanent: false, ...outcome })
  }

  async sendText(input: { toE164: string; body: string; idempotencyKey: string }): Promise<SendOutcome> {
    const failure = this.failures.shift()
    if (failure !== undefined) return failure

    this.counter += 1
    this.sent.push(input)

    return {
      status: 'sent',
      providerMessageId: `msg-${this.counter}`,
      billable: true,
    }
  }
}
