import { describe, expect, it } from 'vitest'
import { findDuplicateCandidates } from './duplicates.ts'
import { makeCustomer } from '../test-support/factories.ts'

const EXISTING = [
  makeCustomer({
    id: 'a',
    fullName: 'Jesus Ayala',
    primaryPhone: '+15550100114',
    primaryEmail: 'jesus.ayala@example.com',
    dealershipCustomerId: 'RV-100114',
    city: 'Abilene',
  }),
  makeCustomer({
    id: 'b',
    fullName: 'Marcy Whitfield',
    primaryPhone: '+15550100127',
    primaryEmail: 'm.whitfield@example.com',
    dealershipCustomerId: 'RV-100127',
    city: 'Lubbock',
  }),
]

describe('findDuplicateCandidates', () => {
  it('treats a matching dealership customer ID as certain', () => {
    const [candidate] = findDuplicateCandidates(
      { fullName: 'J. Ayala', dealershipCustomerId: 'RV-100114' },
      EXISTING,
    )

    expect(candidate?.customer.id).toBe('a')
    expect(candidate?.confidence).toBe('certain')
    expect(candidate?.signals).toContain('dealership_customer_id')
  })

  it('matches on phone regardless of formatting', () => {
    const [candidate] = findDuplicateCandidates(
      { fullName: 'Someone Else', primaryPhone: '(555) 010-0114' },
      EXISTING,
    )

    expect(candidate?.customer.id).toBe('a')
    expect(candidate?.confidence).toBe('strong')
  })

  it('matches on email regardless of case and spacing', () => {
    const [candidate] = findDuplicateCandidates(
      { fullName: 'Different Name', primaryEmail: '  M.Whitfield@Example.com ' },
      EXISTING,
    )

    expect(candidate?.customer.id).toBe('b')
    expect(candidate?.signals).toContain('email')
  })

  it('treats name plus city as circumstantial rather than certain', () => {
    const [candidate] = findDuplicateCandidates(
      { fullName: 'jesus ayala', city: 'abilene' },
      EXISTING,
    )

    expect(candidate?.signals).toContain('name_and_city')
    expect(candidate?.confidence).toBe('possible')
  })

  it('reports a bare name match as the weakest signal', () => {
    const [candidate] = findDuplicateCandidates({ fullName: 'Jesus Ayala' }, EXISTING)

    expect(candidate?.signals).toEqual(['similar_name'])
    expect(candidate?.confidence).toBe('possible')
  })

  it('never reports a match when nothing lines up', () => {
    expect(
      findDuplicateCandidates(
        { fullName: 'Nobody Here', primaryPhone: '(555) 010-9999' },
        EXISTING,
      ),
    ).toEqual([])
  })

  it('skips the record being edited so a customer never matches itself', () => {
    expect(
      findDuplicateCandidates(
        { fullName: 'Jesus Ayala', dealershipCustomerId: 'RV-100114' },
        EXISTING,
        'a',
      ),
    ).toEqual([])
  })

  it('lists the conflicting fields so two people can be told apart', () => {
    const [candidate] = findDuplicateCandidates(
      { fullName: 'Maria Ayala', primaryPhone: '+15550100114', city: 'Lubbock' },
      EXISTING,
    )

    const fields = candidate?.conflicts.map((conflict) => conflict.field) ?? []
    expect(fields).toContain('Full name')
    expect(fields).toContain('City')
  })

  it('ranks the strongest signal first when several customers match', () => {
    const weakThenStrong = [
      makeCustomer({ id: 'weak', fullName: 'Jesus Ayala' }),
      makeCustomer({ id: 'strong', fullName: 'Someone Else', dealershipCustomerId: 'RV-100114' }),
    ]

    const candidates = findDuplicateCandidates(
      { fullName: 'Jesus Ayala', dealershipCustomerId: 'RV-100114' },
      weakThenStrong,
    )

    expect(candidates[0]?.customer.id).toBe('strong')
  })
})
