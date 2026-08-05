/**
 * Routes an inbound WhatsApp message to an action, or to a question.
 *
 * Three guards run before anything is interpreted, in order:
 *
 *   1. The sender must be the approved number. An unknown number is recorded
 *      and refused with a reply that reveals nothing about any customer.
 *   2. The provider message id must be new. Meta retries deliveries, so
 *      processing the same id twice would double-apply a command.
 *   3. The parse must clear the confidence threshold, or the app asks instead
 *      of acting.
 *
 * Only then is the text treated as a command — and even then it is a proposal
 * the executor validates against the working set.
 */

import { parseCommand } from '../domain/messaging/command-parser.ts'
import { executeCommand } from '../domain/messaging/command-executor.ts'
import { composeCommandConfirmation } from '../domain/messaging/messages.ts'
import { isApprovedSender } from '../providers/whatsapp/types.ts'
import type { MessagingPort, WebhookStore } from './ports.ts'
import type { AccountContext } from './ports.ts'

export interface InboundText {
  providerMessageId: string
  fromE164: string
  text: string
  receivedAt: string
}

export type InboundResult =
  | { kind: 'rejected_sender' }
  | { kind: 'duplicate' }
  | { kind: 'replied'; reply: string }
  | { kind: 'applied'; reply: string; customerId: string }
  | { kind: 'asked'; reply: string }

/** How long an unanswered question stays valid. */
export const CLARIFICATION_TTL_MINUTES = 30

export async function handleInboundText(
  store: WebhookStore,
  messaging: MessagingPort,
  account: AccountContext,
  message: InboundText,
  now: Date = new Date(),
): Promise<InboundResult> {
  const approved = isApprovedSender(message.fromE164, account.approvedNumberE164)

  // Recorded either way, so an unauthorised attempt is visible in the audit
  // trail rather than silently dropped.
  const isNew = await store.registerInboundMessage({
    userId: approved ? account.userId : null,
    providerMessageId: message.providerMessageId,
    fromE164: message.fromE164,
    isApprovedSender: approved,
    text: approved ? message.text : null,
  })

  // Meta retries deliveries; the same id must never be applied twice.
  if (!isNew) return { kind: 'duplicate' }

  if (!approved) {
    await store.writeAudit(account.userId, 'Rejected: sender is not the approved number', {
      reason: 'unapproved_sender',
    })
    return { kind: 'rejected_sender' }
  }

  await store.recordUsage(account.userId, 'message_received', 1, 0)

  const open = await store.readOpenClarification(account.userId, now)
  const parsed = parseCommand(message.text, {
    settings: account.settings,
    now,
    hasOpenClarification: open !== null,
  })

  const rows = await store.loadRows(account.userId, now)
  const plan = executeCommand(parsed, {
    rows,
    settings: account.settings,
    now,
    recentReminderCustomerIds: await store.recentReminderCustomerIds(account.userId),
    openClarification:
      open === null ? null : { options: open.options, pendingPayload: open.pendingPayload },
  })

  // Any reply closes the outstanding question, so an abandoned one cannot
  // capture an unrelated message later.
  if (open !== null) await store.resolveClarification(open.id, plan.kind)

  switch (plan.kind) {
    case 'reply':
      await reply(store, messaging, account, plan.body, message.providerMessageId, now)
      return { kind: 'replied', reply: plan.body }

    case 'rejected':
      await reply(store, messaging, account, plan.reason, message.providerMessageId, now)
      return { kind: 'replied', reply: plan.reason }

    case 'clarify':
      await store.openClarification({
        userId: account.userId,
        kind: plan.sessionKind,
        prompt: plan.prompt,
        options: plan.options,
        pendingPayload: plan.pendingPayload,
        expiresAt: new Date(now.getTime() + CLARIFICATION_TTL_MINUTES * 60_000).toISOString(),
      })
      await reply(store, messaging, account, plan.prompt, message.providerMessageId, now)
      return { kind: 'asked', reply: plan.prompt }

    case 'apply': {
      await store.applyCommandEffects(account.userId, plan.customerId, plan.effects, now)
      await store.writeAudit(account.userId, 'Updated from a WhatsApp command', {
        customerId: plan.customerId,
        changes: plan.changes,
      })

      const confirmation = composeCommandConfirmation(plan.customerName, plan.changes)
      await reply(store, messaging, account, confirmation, message.providerMessageId, now)

      return { kind: 'applied', reply: confirmation, customerId: plan.customerId }
    }
  }
}

/**
 * Sends a reply, claimed like any other message.
 *
 * Keyed on the inbound message id, so a retried webhook delivery that somehow
 * got past the duplicate check still cannot produce two replies.
 */
async function reply(
  store: WebhookStore,
  messaging: MessagingPort,
  account: AccountContext,
  body: string,
  inboundMessageId: string,
  now: Date,
): Promise<void> {
  if (account.approvedNumberE164 === null) return

  const idempotencyKey = `command_reply:${inboundMessageId}`
  const notificationId = await store.claimNotification({
    userId: account.userId,
    idempotencyKey,
    kind: 'command_confirmation',
    reminderStage: null,
    followUpId: null,
    customerId: null,
    toNumberE164: account.approvedNumberE164,
    payloadSummary: `Reply (${body.length} chars)`,
  })

  if (notificationId === null) return

  const outcome = await messaging.sendText({
    toE164: account.approvedNumberE164,
    body,
    idempotencyKey,
  })

  await store.recordSendResult(notificationId, {
    ...outcome,
    // Replies inside the 24-hour service window are free.
    billable: false,
    nextAttemptAt: outcome.status === 'failed' ? new Date(now.getTime() + 15 * 60_000).toISOString() : null,
  })

  await store.recordUsage(account.userId, outcome.status === 'sent' ? 'message_sent' : 'message_failed', 1, 0)
}

/** Records a delivery, read or failure receipt against the original send. */
export async function handleStatusEvent(
  store: WebhookStore,
  event: { providerMessageId: string; status: string; errorTitle?: string },
): Promise<void> {
  await store.updateDeliveryStatus(
    event.providerMessageId,
    event.status,
    event.errorTitle ?? null,
  )
}
