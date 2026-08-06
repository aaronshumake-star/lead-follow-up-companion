import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, collectLeadSources, filterCustomerRows } from './customer-filters.ts'
import { buildCustomerRows } from './dashboard.ts'
import {
  makeActivity,
  makeContactMethod,
  makeCustomer,
  makeFollowUp,
  makeVehicleInterest,
} from '../test-support/factories.ts'

const NOW = new Date('2026-08-05T15:00:00.000Z')

const ROWS = buildCustomerRows({
  customers: [
    makeCustomer({
      id: 'ayala',
      fullName: 'Jesus Ayala',
      primaryPhone: '+15550100114',
      primaryEmail: 'jesus.ayala@example.com',
      dealershipCustomerId: 'RV-100114',
      city: 'Abilene',
      leadStatus: 'follow_up_scheduled',
      leadPriority: 'high',
      leadTemperature: 'hot',
      leadSource: 'Website form',
      notes: 'Wants a bunkhouse under 30 feet.',
      createdAt: '2026-08-01T00:00:00.000Z',
    }),
    makeCustomer({
      id: 'okonkwo',
      fullName: 'Renata Okonkwo',
      primaryPhone: '+15550100142',
      leadStatus: 'working',
      leadSource: 'Phone-up',
      createdAt: '2026-06-01T00:00:00.000Z',
    }),
    makeCustomer({
      id: 'mbeki',
      fullName: 'Suzanne Mbeki',
      leadStatus: 'archived',
      leadSource: 'Internet lead',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    makeCustomer({
      id: 'brummett',
      fullName: 'Hal Brummett',
      leadStatus: 'sold',
      leadSource: 'Repeat customer',
      createdAt: '2026-05-01T00:00:00.000Z',
    }),
  ],
  contactMethods: [
    makeContactMethod({ id: 'm1', customerId: 'ayala', method: 'phone_call' }),
    makeContactMethod({ id: 'm2', customerId: 'ayala', method: 'email', value: 'jesus.ayala@example.com' }),
    makeContactMethod({ id: 'm3', customerId: 'okonkwo', method: 'phone_call' }),
  ],
  vehicleInterests: [
    makeVehicleInterest({
      id: 'v1',
      customerId: 'ayala',
      make: 'Cedar Ridge',
      model: 'Trailblazer',
      floorplan: '28BHS',
      stockNumber: 'STK-48211',
    }),
  ],
  activities: [
    makeActivity({
      id: 'a1',
      customerId: 'ayala',
      type: 'outbound_call',
      direction: 'outbound',
      method: 'phone_call',
      performedByUser: true,
    }),
  ],
  followUps: [
    makeFollowUp({
      id: 'f1',
      customerId: 'ayala',
      status: 'pending',
      dueAt: '2026-08-06T15:00:00.000Z',
    }),
  ],
  timeZone: 'UTC',
  now: NOW,
})

function ids(filters: Partial<typeof EMPTY_FILTERS>): string[] {
  return filterCustomerRows(ROWS, { ...EMPTY_FILTERS, ...filters }, NOW).map((row) => row.customer.id)
}

describe('filterCustomerRows', () => {
  it('hides archived customers unless asked for', () => {
    expect(ids({})).not.toContain('mbeki')
    expect(ids({ includeArchived: true })).toContain('mbeki')
  })

  it('can hide closed customers', () => {
    expect(ids({})).toContain('brummett')
    expect(ids({ includeClosed: false })).not.toContain('brummett')
  })

  describe('search', () => {
    it('finds by name', () => {
      expect(ids({ search: 'ayala' })).toEqual(['ayala'])
    })

    it('finds by phone regardless of formatting', () => {
      expect(ids({ search: '(555) 010-0114' })).toEqual(['ayala'])
      expect(ids({ search: '5550100114' })).toEqual(['ayala'])
    })

    it('finds by email', () => {
      expect(ids({ search: 'jesus.ayala@example.com' })).toEqual(['ayala'])
    })

    it('finds by dealership customer ID', () => {
      expect(ids({ search: 'RV-100114' })).toEqual(['ayala'])
    })

    it('finds by RV make, model, floorplan and stock number', () => {
      expect(ids({ search: 'cedar ridge' })).toEqual(['ayala'])
      expect(ids({ search: 'trailblazer' })).toEqual(['ayala'])
      expect(ids({ search: '28BHS' })).toEqual(['ayala'])
      expect(ids({ search: 'STK-48211' })).toEqual(['ayala'])
    })

    it('finds by notes', () => {
      expect(ids({ search: 'bunkhouse' })).toEqual(['ayala'])
    })

    it('requires every term to match', () => {
      expect(ids({ search: 'ayala bunkhouse' })).toEqual(['ayala'])
      expect(ids({ search: 'ayala helicopter' })).toEqual([])
    })
  })

  describe('filters', () => {
    it('filters by status', () => {
      expect(ids({ statuses: ['working'] })).toEqual(['okonkwo'])
    })

    it('filters by priority and temperature', () => {
      expect(ids({ priorities: ['high'] })).toEqual(['ayala'])
      expect(ids({ temperatures: ['hot'] })).toEqual(['ayala'])
    })

    it('filters by contact methods available', () => {
      expect(ids({ methodsAvailable: ['email'] })).toEqual(['ayala'])
    })

    it('filters by methods I have not personally attempted', () => {
      // Ayala has an email channel that has never been tried by me.
      expect(ids({ methodsNotAttempted: ['email'] })).toEqual(['ayala'])
      // The phone was tried, so it should not match.
      expect(ids({ methodsNotAttempted: ['phone_call'] })).toEqual(['okonkwo'])
    })

    it('filters by follow-up state', () => {
      expect(ids({ followUpState: 'has_open' })).toEqual(['ayala'])
      expect(ids({ followUpState: 'no_next_action' })).toEqual(['okonkwo'])
    })

    it('filters by lead source', () => {
      expect(ids({ leadSource: 'Phone-up' })).toEqual(['okonkwo'])
    })

    it('filters by date added', () => {
      expect(ids({ dateAdded: 'last_7_days' })).toEqual(['ayala'])
      expect(ids({ dateAdded: 'older' }).sort()).toEqual(['brummett', 'okonkwo'])
    })
  })
})

describe('collectLeadSources', () => {
  it('lists the distinct sources in alphabetical order', () => {
    expect(collectLeadSources(ROWS)).toEqual([
      'Internet lead',
      'Phone-up',
      'Repeat customer',
      'Website form',
    ])
  })
})
