import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryMessaging, MemoryStore } from './memory-store.ts'
import { handleInboundText, handleStatusEvent } from './webhook-router.ts'
import type { AccountContext } from './ports.ts'
import { makeCustomer, makeFollowUp } from '../test-support/factories.ts'
import { DEFAULT_SETTINGS } from '../domain/settings.ts'

const NOW = new Date('2026-08-05T15:00:00.000Z')
const APPROVED = '+15550100999'

function buildStore() {
  return new MemoryStore({
    settings: { timeZone: 'UTC', morningAt: '09:00' },
    approvedNumberE164: APPROVED,
    customers: [
      makeCustomer({ id: 'ayala', fullName: 'Jesus Ayala', primaryPhone: '+15550100114', leadStatus: 'working' }),
      makeCustomer({ id: 'garcia', fullName: 'Jesus Garcia', primaryPhone: '+15550102281', leadStatus: 'working' }),
      makeCustomer({ id: 'raghu', fullName: 'Priya Raghunathan', leadStatus: 'follow_up_scheduled' }),
    ],
    followUps: [
      makeFollowUp({ id: 'f-raghu', customerId: 'raghu', status: 'overdue', dueAt: '2026-08-03T15:00:00.000Z' }),
    ],
  })
}

function account(store: MemoryStore): AccountContext {
  return {
    userId: store.userId,
    settings: { ...DEFAULT_SETTINGS, timeZone: 'UTC', morningAt: '09:00' },
    approvedNumberE164: APPROVED,
    remindersEnabled: true,
  }
}

function message(text: string, id = `wamid-${Math.random().toString(36).slice(2)}`, from = APPROVED) {
  return { providerMessageId: id, fromE164: from, text, receivedAt: NOW.toISOString() }
}

describe('handleInboundText', () => {
  let store: MemoryStore
  let messaging: MemoryMessaging

  beforeEach(() => {
    store = buildStore()
    messaging = new MemoryMessaging()
  })

  describe('authorisation', () => {
    it('rejects a message from an unknown number', async () => {
      const result = await handleInboundText(
        store,
        messaging,
        account(store),
        message('What is overdue?', 'wamid-1', '+15550100777'),
        NOW,
      )

      expect(result.kind).toBe('rejected_sender')
      // No reply at all, so nothing about any customer leaks to that number.
      expect(messaging.sent).toHaveLength(0)
    })

    it('records the rejection in the audit trail', async () => {
      await handleInboundText(
        store,
        messaging,
        account(store),
        message('Mark everyone sold', 'wamid-2', '+15550100777'),
        NOW,
      )

      expect(store.auditEntries.some((entry) => entry.metadata['reason'] === 'unapproved_sender')).toBe(true)
    })

    it('accepts a message from the approved number', async () => {
      const result = await handleInboundText(store, messaging, account(store), message('What is overdue?'), NOW)

      expect(result.kind).toBe('replied')
      expect(messaging.sent).toHaveLength(1)
    })
  })

  describe('duplicate webhook deliveries', () => {
    it('applies a command only once when the same message id arrives twice', async () => {
      const duplicate = message('Called Jesus Ayala, no answer.', 'wamid-dup')

      const first = await handleInboundText(store, messaging, account(store), duplicate, NOW)
      const second = await handleInboundText(store, messaging, account(store), duplicate, NOW)

      expect(first.kind).toBe('applied')
      expect(second.kind).toBe('duplicate')
      expect(store.appliedEffects).toHaveLength(1)
    })
  })

  describe('commands', () => {
    it('logs a call and schedules the follow-up in one message', async () => {
      const result = await handleInboundText(
        store,
        messaging,
        account(store),
        message('Called Jesus Ayala, no answer. Follow up tomorrow at ten.'),
        NOW,
      )

      expect(result.kind).toBe('applied')

      const effects = store.appliedEffects[0]?.effects ?? []
      expect(effects.some((effect) => effect.type === 'log_activity')).toBe(true)

      const scheduled = effects.find((effect) => effect.type === 'schedule_follow_up')
      expect(scheduled).toBeDefined()
      if (scheduled?.type === 'schedule_follow_up') {
        expect(scheduled.dueAt).toBe('2026-08-06T10:00:00.000Z')
      }
    })

    it('records an outbound command as a personal attempt', async () => {
      await handleInboundText(store, messaging, account(store), message('Called Jesus Ayala, no answer.'), NOW)

      const logged = store.activities.find((activity) => activity.customerId === 'ayala')
      // A command is me saying I did it, unlike a screenshot import.
      expect(logged?.performedByUser).toBe(true)
    })

    it('adds a note', async () => {
      const result = await handleInboundText(
        store,
        messaging,
        account(store),
        message('Add note to Jesus Ayala: wants a bunkhouse under $35,000.'),
        NOW,
      )

      expect(result.kind).toBe('applied')
      expect(store.appliedEffects[0]?.effects[0]?.type).toBe('add_note')
    })

    it('marks a customer sold', async () => {
      await handleInboundText(store, messaging, account(store), message('Mark Jesus Ayala sold.'), NOW)

      expect(store.customers.find((customer) => customer.id === 'ayala')?.leadStatus).toBe('sold')
    })

    it('marks a customer lost', async () => {
      await handleInboundText(
        store,
        messaging,
        account(store),
        message('Jesus Ayala bought elsewhere. Mark lost.'),
        NOW,
      )

      expect(store.customers.find((customer) => customer.id === 'ayala')?.leadStatus).toBe('lost')
    })

    it('completes a follow-up from a DONE quick reply when only one reminder is open', async () => {
      store.recentReminderCustomerIds = async () => ['raghu']

      const result = await handleInboundText(store, messaging, account(store), message('DONE'), NOW)

      expect(result.kind).toBe('applied')
      expect(store.followUps.find((item) => item.id === 'f-raghu')?.status).toBe('completed')
    })
  })

  describe('queries', () => {
    it('answers what is overdue without writing anything', async () => {
      const result = await handleInboundText(store, messaging, account(store), message('What is overdue?'), NOW)

      expect(result.kind).toBe('replied')
      if (result.kind === 'replied') expect(result.reply).toContain('Priya Raghunathan')
      expect(store.appliedEffects).toHaveLength(0)
    })

    it('answers who has no next action', async () => {
      const result = await handleInboundText(
        store,
        messaging,
        account(store),
        message('Who has no next action?'),
        NOW,
      )

      expect(result.kind).toBe('replied')
      if (result.kind === 'replied') expect(result.reply).toContain('Jesus Ayala')
    })

    it('answers who needs contacting today', async () => {
      const result = await handleInboundText(
        store,
        messaging,
        account(store),
        message('Who do I need to contact today?'),
        NOW,
      )

      expect(result.kind).toBe('replied')
    })
  })

  describe('clarification', () => {
    it('asks which customer when two names match', async () => {
      const result = await handleInboundText(
        store,
        messaging,
        account(store),
        message('Called Jesus, no answer.'),
        NOW,
      )

      expect(result.kind).toBe('asked')
      if (result.kind === 'asked') {
        expect(result.reply).toContain('Jesus Ayala')
        expect(result.reply).toContain('Jesus Garcia')
        expect(result.reply).toContain('phone ending 0114')
      }
      expect(store.clarification).not.toBeNull()
    })

    it('completes the original command when the answer arrives', async () => {
      await handleInboundText(store, messaging, account(store), message('Called Jesus, no answer.', 'w-1'), NOW)

      const result = await handleInboundText(store, messaging, account(store), message('1', 'w-2'), NOW)

      expect(result.kind).toBe('applied')
      if (result.kind === 'applied') expect(result.customerId).toBe('ayala')
    })

    it('refuses a numeric reply once the question has expired', async () => {
      await handleInboundText(store, messaging, account(store), message('Called Jesus, no answer.', 'w-1'), NOW)

      // A stale question must not capture an unrelated later message.
      const later = new Date(NOW.getTime() + 45 * 60_000)
      const result = await handleInboundText(store, messaging, account(store), message('1', 'w-2'), later)

      expect(result.kind).toBe('replied')
      if (result.kind === 'replied') expect(result.reply).toMatch(/no question waiting/i)
    })

    it('keeps only one open question at a time', async () => {
      await handleInboundText(store, messaging, account(store), message('Called Jesus, no answer.', 'w-1'), NOW)
      await handleInboundText(store, messaging, account(store), message('Texted Jesus.', 'w-2'), NOW)

      expect(store.clarification?.resolvedAt).toBeNull()
    })
  })

  describe('replies', () => {
    it('never sends two replies for one inbound message', async () => {
      const inbound = message('What is overdue?', 'wamid-reply')

      await handleInboundText(store, messaging, account(store), inbound, NOW)
      await handleInboundText(store, messaging, account(store), inbound, NOW)

      expect(messaging.sent).toHaveLength(1)
    })

    it('marks a reply as non-billable, since it sits in the service window', async () => {
      await handleInboundText(store, messaging, account(store), message('What is overdue?'), NOW)

      expect(store.usage.some((entry) => entry.kind === 'message_sent' && entry.costUsd === 0)).toBe(true)
    })
  })
})

describe('handleStatusEvent', () => {
  it('records a delivery failure against the original send', async () => {
    const store = buildStore()
    const id = await store.claimNotification({
      userId: store.userId,
      idempotencyKey: 'k',
      kind: 'follow_up_reminder',
      reminderStage: 'due_now',
      followUpId: null,
      customerId: null,
      toNumberE164: APPROVED,
      payloadSummary: 'test',
    })

    await store.recordSendResult(id ?? '', { status: 'sent', providerMessageId: 'wamid-out-1' })
    await handleStatusEvent(store, {
      providerMessageId: 'wamid-out-1',
      status: 'failed',
      errorTitle: 'Undeliverable',
    })

    expect(store.notifications[0]?.status).toBe('failed')
    expect(store.notifications[0]?.error).toBe('Undeliverable')
  })
})
