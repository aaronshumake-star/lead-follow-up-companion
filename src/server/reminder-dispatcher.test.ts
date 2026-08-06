import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryMessaging, MemoryStore } from './memory-store.ts'
import { dispatchReminders } from './reminder-dispatcher.ts'
import { makeCustomer, makeFollowUp } from '../test-support/factories.ts'

const NOW = new Date('2026-08-05T15:00:00.000Z')

function storeWith(followUps: Parameters<typeof makeFollowUp>[0][], settings = {}) {
  return new MemoryStore({
    settings: { timeZone: 'UTC', morningAt: '09:00', endOfDayDigestAt: '17:30', ...settings },
    customers: [makeCustomer({ id: 'c1', fullName: 'Jesus Ayala', leadStatus: 'follow_up_scheduled' })],
    followUps: followUps.map((overrides) => makeFollowUp({ customerId: 'c1', ...overrides })),
  })
}

describe('dispatchReminders', () => {
  let messaging: MemoryMessaging

  beforeEach(() => {
    messaging = new MemoryMessaging()
  })

  it('sends a reminder for a follow-up that has come due', async () => {
    const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }])

    const summary = await dispatchReminders(store, messaging, { now: NOW })

    expect(summary.sent).toBe(1)
    expect(messaging.sent[0]?.body).toContain('FOLLOW-UP')
    expect(messaging.sent[0]?.toE164).toBe('+15550100999')
  })

  it('never sends the same reminder twice, however often it runs', async () => {
    const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }])

    const first = await dispatchReminders(store, messaging, { now: NOW })
    const second = await dispatchReminders(store, messaging, { now: NOW })

    expect(first.sent).toBe(1)
    expect(second.sent).toBe(0)
    expect(second.suppressed).toBe(1)
    expect(messaging.sent).toHaveLength(1)
  })

  it('survives two concurrent runs without double sending', async () => {
    const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }])

    // The claim is the serialisation point: whoever inserts the key first owns
    // the send, and the other run finds it taken.
    const [a, b] = await Promise.all([
      dispatchReminders(store, messaging, { now: NOW }),
      dispatchReminders(store, messaging, { now: NOW }),
    ])

    expect(a.sent + b.sent).toBe(1)
    expect(messaging.sent).toHaveLength(1)
  })

  it('chases an overdue follow-up at the configured interval, not every run', async () => {
    const store = storeWith(
      [{ id: 'f1', status: 'overdue', dueAt: '2026-08-01T15:00:00.000Z' }],
      { overdueReminderIntervalHours: 24 },
    )

    const first = await dispatchReminders(store, messaging, { now: NOW })
    // An hour later is still the same 24-hour bucket, so nothing new is sent.
    const later = await dispatchReminders(store, messaging, {
      now: new Date(NOW.getTime() + 3_600_000),
    })

    expect(first.sent).toBe(1)
    expect(later.sent).toBe(0)
  })

  it('does not notify a completed follow-up', async () => {
    const store = storeWith([
      { id: 'f1', status: 'completed', dueAt: '2026-08-05T14:00:00.000Z', completedAt: '2026-08-05T14:30:00.000Z' },
    ])

    expect((await dispatchReminders(store, messaging, { now: NOW })).sent).toBe(0)
  })

  it('does not notify a canceled follow-up', async () => {
    const store = storeWith([
      { id: 'f1', status: 'canceled', dueAt: '2026-08-05T14:00:00.000Z', canceledAt: '2026-08-05T14:30:00.000Z' },
    ])

    expect((await dispatchReminders(store, messaging, { now: NOW })).sent).toBe(0)
  })

  it('reminds about the new time after a reschedule, never the old one', async () => {
    // Digests are off so this isolates the individual reminder; the later run
    // would otherwise also fall inside the morning digest window.
    const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }], {
      morningDigestEnabled: false,
      endOfDayDigestEnabled: false,
    })
    await dispatchReminders(store, messaging, { now: NOW })

    const firstKey = store.notifications[0]?.idempotencyKey

    // Rescheduling changes the due time, which changes the idempotency key, so
    // the new time gets its own reminder and the old one can never fire again.
    const followUp = store.followUps[0]
    if (followUp !== undefined) followUp.dueAt = '2026-08-06T09:00:00.000Z'

    const later = await dispatchReminders(store, messaging, {
      now: new Date('2026-08-06T09:05:00.000Z'),
    })

    expect(later.sent).toBe(1)
    expect(messaging.sent).toHaveLength(2)
    expect(store.notifications[1]?.idempotencyKey).not.toBe(firstKey)
    expect(store.notifications[1]?.idempotencyKey).toContain('2026-08-06T09:00')
  })

  it('returns a lapsed waiting deadline to the queue and reminds in the same run', async () => {
    const store = storeWith([
      {
        id: 'f1',
        status: 'waiting_on_customer',
        dueAt: '2026-08-02T15:00:00.000Z',
        waitingUntil: '2026-08-05T14:00:00.000Z',
      },
    ])

    const summary = await dispatchReminders(store, messaging, { now: NOW })

    expect(summary.expiredWaiting).toBe(1)
    expect(store.followUps[0]?.status).toBe('overdue')
    expect(summary.sent).toBe(1)
  })

  it('reminds about an appointment within the configured lead time', async () => {
    const store = storeWith(
      [
        {
          id: 'f1',
          status: 'pending',
          dueAt: '2026-08-06T09:00:00.000Z',
          isAppointment: true,
        },
      ],
      { appointmentReminderLeadHours: 24 },
    )

    const summary = await dispatchReminders(store, messaging, { now: NOW })

    expect(summary.sent).toBe(1)
    expect(messaging.sent[0]?.body).toContain('APPOINTMENT')
  })

  it('sends a morning digest inside its window', async () => {
    const store = storeWith([{ id: 'f1', status: 'overdue', dueAt: '2026-08-01T15:00:00.000Z' }], {
      timeZone: 'UTC',
      morningAt: '09:00',
      digestOnly: true,
    })

    const summary = await dispatchReminders(store, messaging, {
      now: new Date('2026-08-05T09:10:00.000Z'),
    })

    expect(summary.sent).toBe(1)
    expect(messaging.sent[0]?.body).toContain('DUE TODAY')
  })

  it('sends an end-of-day digest inside its window', async () => {
    const store = storeWith([{ id: 'f1', status: 'overdue', dueAt: '2026-08-01T15:00:00.000Z' }], {
      timeZone: 'UTC',
      endOfDayDigestAt: '17:30',
      digestOnly: true,
      morningDigestEnabled: false,
    })

    const summary = await dispatchReminders(store, messaging, {
      now: new Date('2026-08-05T17:40:00.000Z'),
    })

    expect(summary.sent).toBe(1)
    expect(messaging.sent[0]?.body).toContain('STILL OPEN TODAY')
  })

  it('collapses to digests only when digest-only mode is on', async () => {
    const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }], {
      digestOnly: true,
      morningDigestEnabled: false,
      endOfDayDigestEnabled: false,
    })

    expect((await dispatchReminders(store, messaging, { now: NOW })).sent).toBe(0)
  })

  it('sends nothing at all when reminders are switched off', async () => {
    const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }])
    store.remindersEnabled = false

    expect((await dispatchReminders(store, messaging, { now: NOW })).sent).toBe(0)
  })

  it('still expires waiting deadlines when reminders are off', async () => {
    // The dashboard is the fallback surface, so the queue has to stay correct
    // even when messaging is disabled.
    const store = storeWith([
      {
        id: 'f1',
        status: 'waiting_on_customer',
        dueAt: '2026-08-02T15:00:00.000Z',
        waitingUntil: '2026-08-05T14:00:00.000Z',
      },
    ])
    store.remindersEnabled = false

    const summary = await dispatchReminders(store, messaging, { now: NOW })

    expect(summary.expiredWaiting).toBe(1)
    expect(summary.sent).toBe(0)
  })

  it('sends nothing when no approved number is configured', async () => {
    const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }])
    store.approvedNumberE164 = null

    expect((await dispatchReminders(store, messaging, { now: NOW })).sent).toBe(0)
  })

  describe('failure handling', () => {
    it('schedules a retry for a transient failure', async () => {
      const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }])
      messaging.queueFailure({ permanent: false })

      const summary = await dispatchReminders(store, messaging, { now: NOW })

      expect(summary.failed).toBe(1)
      expect(store.notifications[0]?.permanentFailure).toBe(false)
      expect(store.notifications[0]?.nextAttemptAt).not.toBeNull()
    })

    it('marks a permanent failure and stops retrying', async () => {
      const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }])
      messaging.queueFailure({ permanent: true })

      await dispatchReminders(store, messaging, { now: NOW })

      expect(store.notifications[0]?.permanentFailure).toBe(true)
      expect(store.notifications[0]?.nextAttemptAt).toBeNull()
    })

    it('retries a transient failure on a later run without a second claim', async () => {
      const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }])
      messaging.queueFailure({ permanent: false })

      await dispatchReminders(store, messaging, { now: NOW })
      const later = await dispatchReminders(store, messaging, {
        now: new Date(NOW.getTime() + 20 * 60_000),
      })

      expect(later.retried).toBe(1)
      // Still one logical message: the retry reused the original claim.
      expect(store.notifications).toHaveLength(1)
      expect(store.notifications[0]?.status).toBe('sent')
    })

    it('gives up after the configured attempt cap', async () => {
      const store = storeWith([{ id: 'f1', status: 'pending', dueAt: '2026-08-05T14:50:00.000Z' }], {
        reminderMaxAttempts: 2,
      })

      messaging.queueFailure({ permanent: false })
      messaging.queueFailure({ permanent: false })

      await dispatchReminders(store, messaging, { now: NOW })
      await dispatchReminders(store, messaging, { now: new Date(NOW.getTime() + 20 * 60_000) })

      expect(store.notifications[0]?.permanentFailure).toBe(true)
    })
  })
})
