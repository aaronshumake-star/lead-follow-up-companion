import { describe, expect, it } from 'vitest'
import {
  effectiveDueAt,
  findOpenFollowUp,
  resolveNextAction,
  sortByUrgency,
  summarizeQueue,
} from './next-action.ts'
import type { FollowUp } from './models.ts'
import type { FollowUpStatus, LeadStatus } from './vocabulary.ts'
import { DEMO_CUSTOMERS, followUpsForCustomer } from '../data/fixtures.ts'
import { makeCustomer as buildCustomer, makeFollowUp as buildFollowUp } from '../test-support/factories.ts'

const NOW = new Date('2026-08-05T15:00:00.000Z')

function makeCustomer(leadStatus: LeadStatus, id = 'cust-1') {
  return buildCustomer({ id, leadStatus })
}

function makeFollowUp(status: FollowUpStatus, dueAt: string, extra: Partial<FollowUp> = {}): FollowUp {
  return buildFollowUp({ status, dueAt, completedAt: null, ...extra })
}

describe('resolveNextAction', () => {
  it('flags an active customer with no follow-up as having no next action', () => {
    const action = resolveNextAction(makeCustomer('working'), [], NOW)

    expect(action.state).toBe('no_next_action')
    expect(action.hasNextAction).toBe(false)
  })

  it('treats a completed follow-up as no coverage at all', () => {
    // Completing a follow-up without booking the next one is precisely how a
    // lead goes quiet, so it must not count as covered.
    const completed = makeFollowUp('completed', '2026-08-01T15:00:00.000Z', {
      completedAt: '2026-08-01T15:00:00.000Z',
    })
    const action = resolveNextAction(makeCustomer('working'), [completed], NOW)

    expect(action.hasNextAction).toBe(false)
  })

  it.each(['sold', 'lost', 'do_not_contact', 'archived'] as const)(
    'treats %s as covered without a follow-up',
    (status) => {
      const action = resolveNextAction(makeCustomer(status), [], NOW)

      expect(action.hasNextAction).toBe(true)
      expect(action.state).toBe(status)
      expect(action.isOverdue).toBe(false)
    },
  )

  it('reports a pending follow-up in the future as scheduled and not overdue', () => {
    const action = resolveNextAction(
      makeCustomer('follow_up_scheduled'),
      [makeFollowUp('pending', '2026-08-06T15:00:00.000Z')],
      NOW,
    )

    expect(action.state).toBe('follow_up_scheduled')
    expect(action.isOverdue).toBe(false)
    expect(action.dueAt).toBe('2026-08-06T15:00:00.000Z')
  })

  it('reports a past due follow-up as overdue', () => {
    const action = resolveNextAction(
      makeCustomer('follow_up_scheduled'),
      [makeFollowUp('pending', '2026-08-03T15:00:00.000Z')],
      NOW,
    )

    expect(action.isOverdue).toBe(true)
    expect(action.reason).toBe('Follow-up is overdue')
  })

  it('uses the waiting deadline rather than the due date while waiting on a customer', () => {
    const waiting = makeFollowUp('waiting_on_customer', '2026-08-01T15:00:00.000Z', {
      waitingUntil: '2026-08-09T15:00:00.000Z',
    })
    const action = resolveNextAction(makeCustomer('waiting_on_customer'), [waiting], NOW)

    expect(action.state).toBe('waiting_on_customer')
    expect(action.dueAt).toBe('2026-08-09T15:00:00.000Z')
    expect(action.isOverdue).toBe(false)
  })

  it('surfaces a waiting customer once the deadline has elapsed', () => {
    const waiting = makeFollowUp('waiting_on_customer', '2026-07-20T15:00:00.000Z', {
      waitingUntil: '2026-08-04T15:00:00.000Z',
    })
    const action = resolveNextAction(makeCustomer('waiting_on_customer'), [waiting], NOW)

    expect(action.isOverdue).toBe(true)
    expect(action.reason).toBe('Waiting period elapsed')
  })

  it('uses the snooze time for a snoozed follow-up', () => {
    const snoozed = makeFollowUp('snoozed', '2026-08-01T15:00:00.000Z', {
      snoozedUntil: '2026-08-20T15:00:00.000Z',
    })

    expect(effectiveDueAt(snoozed)).toBe('2026-08-20T15:00:00.000Z')
    expect(resolveNextAction(makeCustomer('working'), [snoozed], NOW).isOverdue).toBe(false)
  })

  it('reports a booked appointment as its own state', () => {
    const action = resolveNextAction(
      makeCustomer('appointment_scheduled'),
      [makeFollowUp('pending', '2026-08-07T15:00:00.000Z')],
      NOW,
    )

    expect(action.state).toBe('appointment_scheduled')
  })
})

describe('findOpenFollowUp', () => {
  it('ignores completed and canceled follow-ups', () => {
    const followUps = [
      makeFollowUp('completed', '2026-08-01T15:00:00.000Z', { completedAt: '2026-08-01T15:00:00.000Z' }),
      makeFollowUp('canceled', '2026-08-02T15:00:00.000Z'),
    ]

    expect(findOpenFollowUp(followUps)).toBeNull()
  })

  it('picks the earliest commitment if data ever contains more than one', () => {
    const followUps = [
      makeFollowUp('pending', '2026-08-20T15:00:00.000Z'),
      makeFollowUp('pending', '2026-08-06T15:00:00.000Z'),
    ]

    expect(findOpenFollowUp(followUps)?.dueAt).toBe('2026-08-06T15:00:00.000Z')
  })
})

describe('summarizeQueue', () => {
  it('counts the seed fixtures the way the dashboard reports them', () => {
    const actions = DEMO_CUSTOMERS.map((customer) =>
      resolveNextAction(customer, followUpsForCustomer(customer.id)),
    )
    const counts = summarizeQueue(actions)

    expect(counts.total).toBe(DEMO_CUSTOMERS.length)
    // Renata Okonkwo and Travis Lindqvist are seeded without a follow-up.
    expect(counts.noNextAction).toBe(2)
    expect(counts.overdue).toBe(1)
    expect(counts.waitingOnCustomer).toBe(1)
    // Sold, lost, do-not-contact and archived.
    expect(counts.closed).toBe(4)
  })
})

describe('sortByUrgency', () => {
  it('puts forgotten leads above overdue ones, and overdue above scheduled', () => {
    const forgotten = resolveNextAction(makeCustomer('working', 'forgotten'), [], NOW)
    const overdue = resolveNextAction(
      makeCustomer('follow_up_scheduled', 'overdue'),
      [makeFollowUp('overdue', '2026-08-01T15:00:00.000Z')],
      NOW,
    )
    const scheduled = resolveNextAction(
      makeCustomer('follow_up_scheduled', 'scheduled'),
      [makeFollowUp('pending', '2026-08-09T15:00:00.000Z')],
      NOW,
    )

    const order = sortByUrgency([scheduled, overdue, forgotten]).map((action) => action.customerId)
    expect(order).toEqual(['forgotten', 'overdue', 'scheduled'])
  })
})
