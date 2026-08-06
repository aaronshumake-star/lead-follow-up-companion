import { describe, expect, it } from 'vitest'
import { buildDashboard, type DashboardInput } from './dashboard.ts'
import {
  makeActivity,
  makeContactMethod,
  makeCustomer,
  makeFollowUp,
} from '../test-support/factories.ts'
import type { Activity, Customer, CustomerContactMethod, FollowUp } from './models.ts'

const NOW = new Date('2026-08-05T15:00:00.000Z')
const TIME_ZONE = 'UTC'

function build(parts: {
  customers?: Customer[]
  followUps?: FollowUp[]
  activities?: Activity[]
  contactMethods?: CustomerContactMethod[]
}) {
  const input: DashboardInput = {
    customers: parts.customers ?? [],
    contactMethods: parts.contactMethods ?? [],
    vehicleInterests: [],
    activities: parts.activities ?? [],
    followUps: parts.followUps ?? [],
    timeZone: TIME_ZONE,
    now: NOW,
  }

  return buildDashboard(input)
}

function hoursFromNow(hours: number): string {
  return new Date(NOW.getTime() + hours * 3_600_000).toISOString()
}

describe('buildDashboard', () => {
  it('puts an active customer with no follow-up in the no-next-action queue', () => {
    const dashboard = build({ customers: [makeCustomer({ id: 'c1', leadStatus: 'working' })] })

    expect(dashboard.counts.noNextAction).toBe(1)
    expect(dashboard.noNextAction[0]?.customer.id).toBe('c1')
  })

  it.each(['sold', 'lost', 'do_not_contact'] as const)(
    'excludes a %s customer from the no-next-action queue',
    (status) => {
      const dashboard = build({ customers: [makeCustomer({ id: 'c1', leadStatus: status })] })

      expect(dashboard.counts.noNextAction).toBe(0)
    },
  )

  it('excludes an archived customer from every working queue', () => {
    const dashboard = build({
      customers: [makeCustomer({ id: 'c1', leadStatus: 'archived' })],
      followUps: [makeFollowUp({ customerId: 'c1', status: 'pending', dueAt: hoursFromNow(-48) })],
    })

    expect(dashboard.overdue).toHaveLength(0)
    expect(dashboard.noNextAction).toHaveLength(0)
    expect(dashboard.actionRequired).toHaveLength(0)
    // The row still exists for the customer list, which can show archived.
    expect(dashboard.rows).toHaveLength(1)
  })

  it('keeps an overdue lead visible no matter how long it has been overdue', () => {
    const dashboard = build({
      customers: [makeCustomer({ id: 'c1', leadStatus: 'follow_up_scheduled' })],
      followUps: [
        makeFollowUp({ id: 'f1', customerId: 'c1', status: 'pending', dueAt: hoursFromNow(-24 * 45) }),
      ],
    })

    expect(dashboard.overdue).toHaveLength(1)
    expect(dashboard.actionRequired).toHaveLength(1)
  })

  it('sorts the overdue queue most overdue first', () => {
    const dashboard = build({
      customers: [
        makeCustomer({ id: 'recent', leadStatus: 'follow_up_scheduled' }),
        makeCustomer({ id: 'ancient', leadStatus: 'follow_up_scheduled' }),
      ],
      followUps: [
        makeFollowUp({ id: 'f1', customerId: 'recent', status: 'pending', dueAt: hoursFromNow(-2) }),
        makeFollowUp({ id: 'f2', customerId: 'ancient', status: 'pending', dueAt: hoursFromNow(-200) }),
      ],
    })

    expect(dashboard.overdue.map((row) => row.customer.id)).toEqual(['ancient', 'recent'])
  })

  it('treats work due within two hours as action required, and later work as not', () => {
    const dashboard = build({
      customers: [
        makeCustomer({ id: 'soon', leadStatus: 'follow_up_scheduled' }),
        makeCustomer({ id: 'later', leadStatus: 'follow_up_scheduled' }),
      ],
      followUps: [
        makeFollowUp({ id: 'f1', customerId: 'soon', status: 'pending', dueAt: hoursFromNow(1) }),
        makeFollowUp({ id: 'f2', customerId: 'later', status: 'pending', dueAt: hoursFromNow(6) }),
      ],
    })

    expect(dashboard.actionRequired.map((row) => row.customer.id)).toEqual(['soon'])
  })

  it('counts a lapsed waiting deadline as action required', () => {
    const dashboard = build({
      customers: [makeCustomer({ id: 'c1', leadStatus: 'waiting_on_customer' })],
      followUps: [
        makeFollowUp({
          id: 'f1',
          customerId: 'c1',
          status: 'waiting_on_customer',
          dueAt: hoursFromNow(-72),
          waitingUntil: hoursFromNow(-1),
        }),
      ],
    })

    expect(dashboard.actionRequired).toHaveLength(1)
    expect(dashboard.counts.waitingForCustomer).toBe(1)
  })

  it('separates due today from due tomorrow', () => {
    const dashboard = build({
      customers: [
        makeCustomer({ id: 'today', leadStatus: 'follow_up_scheduled' }),
        makeCustomer({ id: 'tomorrow', leadStatus: 'follow_up_scheduled' }),
      ],
      followUps: [
        makeFollowUp({ id: 'f1', customerId: 'today', status: 'pending', dueAt: hoursFromNow(5) }),
        makeFollowUp({ id: 'f2', customerId: 'tomorrow', status: 'pending', dueAt: hoursFromNow(26) }),
      ],
    })

    expect(dashboard.dueToday.map((row) => row.customer.id)).toEqual(['today'])
    expect(dashboard.dueTomorrow.map((row) => row.customer.id)).toEqual(['tomorrow'])
  })

  it('collects upcoming appointments separately', () => {
    const dashboard = build({
      customers: [makeCustomer({ id: 'c1', leadStatus: 'appointment_scheduled' })],
      followUps: [
        makeFollowUp({
          id: 'f1',
          customerId: 'c1',
          status: 'pending',
          dueAt: hoursFromNow(48),
          isAppointment: true,
        }),
      ],
    })

    expect(dashboard.counts.upcomingAppointments).toBe(1)
    expect(dashboard.upcomingAppointments[0]?.customer.id).toBe('c1')
  })

  it('does not count a snoozed follow-up as overdue before it returns', () => {
    const dashboard = build({
      customers: [makeCustomer({ id: 'c1', leadStatus: 'follow_up_scheduled' })],
      followUps: [
        makeFollowUp({
          id: 'f1',
          customerId: 'c1',
          status: 'snoozed',
          dueAt: hoursFromNow(-48),
          snoozedUntil: hoursFromNow(72),
        }),
      ],
    })

    expect(dashboard.overdue).toHaveLength(0)
    expect(dashboard.counts.noNextAction).toBe(0)
  })

  it('flags an untouched screenshot import as needing review', () => {
    const dashboard = build({
      customers: [
        makeCustomer({ id: 'c1', leadStatus: 'new', source: 'screenshot' }),
      ],
      contactMethods: [makeContactMethod({ id: 'm1', customerId: 'c1' })],
      activities: [
        // CRM-visible activity only: not something I did.
        makeActivity({
          id: 'a1',
          customerId: 'c1',
          type: 'outbound_text',
          direction: 'outbound',
          method: 'sms',
          source: 'screenshot',
          performedByUser: false,
        }),
      ],
      followUps: [makeFollowUp({ id: 'f1', customerId: 'c1', status: 'pending', dueAt: hoursFromNow(48) })],
    })

    expect(dashboard.counts.needsReview).toBe(1)
  })

  it('reports the most recently created customers first', () => {
    const dashboard = build({
      customers: [
        makeCustomer({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
        makeCustomer({ id: 'new', createdAt: '2026-08-01T00:00:00.000Z' }),
      ],
    })

    expect(dashboard.recentlyAdded[0]?.customer.id).toBe('new')
  })
})
