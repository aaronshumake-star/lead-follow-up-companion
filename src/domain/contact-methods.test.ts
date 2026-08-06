import { describe, expect, it } from 'vitest'
import { summarizeContactMethods } from './contact-methods.ts'
import type { Activity, CustomerContactMethod } from './models.ts'
import type { ContactMethod } from './vocabulary.ts'
import { activitiesForCustomer, contactMethodsForCustomer } from '../data/fixtures.ts'
import { makeActivity, makeContactMethod } from '../test-support/factories.ts'

function method(
  id: string,
  kind: ContactMethod,
  overrides: Partial<CustomerContactMethod> = {},
): CustomerContactMethod {
  return makeContactMethod({ id, method: kind, value: 'value', ...overrides })
}

function activity(
  id: string,
  overrides: Partial<Activity> & Pick<Activity, 'type' | 'direction' | 'occurredAt'>,
): Activity {
  return makeActivity({ id, ...overrides })
}

describe('summarizeContactMethods', () => {
  it('counts only contact I personally made as attempted', () => {
    // The distinction the product depends on: a CRM screenshot showing an
    // outbound email does not mean I emailed anyone.
    const summary = summarizeContactMethods(
      [method('m1', 'phone_call'), method('m2', 'email')],
      [
        activity('a1', {
          type: 'outbound_email',
          direction: 'outbound',
          method: 'email',
          occurredAt: '2026-08-01T15:00:00.000Z',
          source: 'screenshot',
          performedByUser: false,
        }),
      ],
    )

    expect(summary.methodsAttempted).toEqual([])
    expect(summary.totalAttempts).toBe(0)
    expect(summary.methodsNotAttempted).toEqual(['phone_call', 'email'])
    expect(summary.lastOutboundAttemptAt).toBeNull()
  })

  it('records an inbound response even when I did not initiate it', () => {
    const summary = summarizeContactMethods(
      [method('m1', 'phone_call')],
      [
        activity('a1', {
          type: 'inbound_call',
          direction: 'inbound',
          method: 'phone_call',
          occurredAt: '2026-08-02T15:00:00.000Z',
        }),
      ],
    )

    expect(summary.lastInboundResponseAt).toBe('2026-08-02T15:00:00.000Z')
    expect(summary.methodsAttempted).toEqual([])
  })

  it('tracks the most recent outbound attempt across several activities', () => {
    const summary = summarizeContactMethods(
      [method('m1', 'phone_call'), method('m2', 'sms')],
      [
        activity('a1', {
          type: 'outbound_call',
          direction: 'outbound',
          method: 'phone_call',
          occurredAt: '2026-08-01T15:00:00.000Z',
          performedByUser: true,
        }),
        activity('a2', {
          type: 'outbound_text',
          direction: 'outbound',
          method: 'sms',
          occurredAt: '2026-08-04T15:00:00.000Z',
          performedByUser: true,
        }),
      ],
    )

    expect(summary.totalAttempts).toBe(2)
    expect(summary.lastOutboundAttemptAt).toBe('2026-08-04T15:00:00.000Z')
    expect(summary.methodsAttempted).toEqual(['phone_call', 'sms'])
    expect(summary.methodsNotAttempted).toEqual([])
  })

  it('excludes an opted-out channel from availability and recommendation', () => {
    const summary = summarizeContactMethods([method('m1', 'phone_call', { optedOut: true })], [])

    expect(summary.methodsAvailable).toEqual([])
    expect(summary.recommendedNextMethod).toBeNull()
    expect(summary.recommendationReason).toBe('No usable contact method on file')
  })

  it('recommends the highest-preference channel that has not been tried', () => {
    const summary = summarizeContactMethods(
      [method('m1', 'email'), method('m2', 'phone_call'), method('m3', 'sms')],
      [
        activity('a1', {
          type: 'outbound_call',
          direction: 'outbound',
          method: 'phone_call',
          occurredAt: '2026-08-01T15:00:00.000Z',
          performedByUser: true,
        }),
      ],
    )

    expect(summary.recommendedNextMethod).toBe('sms')
    expect(summary.recommendationReason).toBe('Not tried yet')
  })

  it('returns to the coldest channel once everything has been tried', () => {
    const summary = summarizeContactMethods(
      [method('m1', 'phone_call'), method('m2', 'sms')],
      [
        activity('a1', {
          type: 'outbound_call',
          direction: 'outbound',
          method: 'phone_call',
          occurredAt: '2026-07-01T15:00:00.000Z',
          performedByUser: true,
        }),
        activity('a2', {
          type: 'outbound_text',
          direction: 'outbound',
          method: 'sms',
          occurredAt: '2026-08-01T15:00:00.000Z',
          performedByUser: true,
        }),
      ],
    )

    expect(summary.recommendedNextMethod).toBe('phone_call')
    expect(summary.recommendationReason).toBe('Longest since last attempt')
  })

  it('reads the seeded screenshot-only customer as untouched', () => {
    // Travis Lindqvist has an auto-responder text in his CRM record and nothing
    // from me, so every channel should still read as untried.
    const summary = summarizeContactMethods(
      contactMethodsForCustomer('c-lindqvist'),
      activitiesForCustomer('c-lindqvist'),
    )

    expect(summary.totalAttempts).toBe(0)
    expect(summary.methodsAttempted).toEqual([])
    expect(summary.methodsNotAttempted).toEqual(['phone_call', 'sms'])
    expect(summary.recommendedNextMethod).toBe('phone_call')
  })
})
