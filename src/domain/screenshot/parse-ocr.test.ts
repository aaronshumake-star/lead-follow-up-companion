import { describe, expect, it } from 'vitest'
import { parseOcrText } from './parse-ocr.ts'

function parse(text: string) {
  const result = parseOcrText(text, { now: new Date('2026-08-05T15:00:00.000Z') })
  if (!result.ok) throw new Error(`parse failed: ${result.issues.join(', ')}`)
  return result.value
}

describe('parseOcrText', () => {
  it('reads labelled customer fields', () => {
    const value = parse(
      [
        'Customer: Jesus Ayala',
        'ID: RV-100114',
        'Phone: (555) 010-0114',
        'Email: jesus.ayala@example.com',
        'City: Abilene',
        'State: TX',
        'Source: Website form',
        'Salesperson: Me',
      ].join('\n'),
    )

    expect(value.customer.fullName).toBe('Jesus Ayala')
    expect(value.customer.customerId).toBe('RV-100114')
    expect(value.customer.phone).toBe('(555) 010-0114')
    expect(value.customer.email).toBe('jesus.ayala@example.com')
    expect(value.customer.city).toBe('Abilene')
    expect(value.customer.state).toBe('TX')
    expect(value.leadSource).toBe('Website form')
    expect(value.salesperson).toBe('Me')
  })

  it('reads a combined "City, ST" line', () => {
    const value = parse('Customer: Travis Lindqvist\nSweetwater, TX\nPhone: (555) 010-0155')

    expect(value.customer.city).toBe('Sweetwater')
    expect(value.customer.state).toBe('TX')
  })

  it('splits a full name into first and last', () => {
    const value = parse('Customer: Renata Okonkwo\nPhone: (555) 010-0142')

    expect(value.customer.firstName).toBe('Renata')
    expect(value.customer.lastName).toBe('Okonkwo')
  })

  it('reads vehicle interest', () => {
    const value = parse(
      [
        'Customer: Wanda Petrossian',
        'Phone: (555) 010-0310',
        'Year: 2026',
        'Make: Cedar Ridge',
        'Model: Reflection',
        'Floorplan: 31MB',
        'Stock: STK-49110',
        'Condition: New',
      ].join('\n'),
    )

    expect(value.vehicleInterest.year).toBe(2026)
    expect(value.vehicleInterest.make).toBe('Cedar Ridge')
    expect(value.vehicleInterest.floorplan).toBe('31MB')
    expect(value.vehicleInterest.stockNumber).toBe('STK-49110')
    expect(value.vehicleInterest.newOrUsed).toBe('new')
  })

  it('derives availability from what is on file, not from what was sent', () => {
    const value = parse(
      'Customer: Jesus Ayala\nPhone: (555) 010-0114\nEmail: a@example.com\nMobile number on file',
    )

    const methods = value.availableContactMethods.map((method) => method.method)
    expect(methods).toContain('phone_call')
    expect(methods).toContain('sms')
    expect(methods).toContain('email')
  })

  it('never claims the current user performed a CRM activity', () => {
    const value = parse(
      'Customer: Jesus Ayala\nPhone: (555) 010-0114\nOutbound text 2 days ago\nOutbound email sent',
    )

    expect(value.visibleActivities.length).toBeGreaterThan(0)
    for (const activity of value.visibleActivities) {
      // Null means unknown, and unknown must never be read as "yes".
      expect(activity.performedByCurrentUser).toBeNull()
    }
  })

  it('resolves a relative timeline date', () => {
    const value = parse('Customer: Jesus Ayala\nPhone: (555) 010-0114\nOutbound call 2 days ago')

    const occurred = value.visibleActivities[0]?.occurredAt
    expect(occurred).not.toBeNull()
    expect(new Date(occurred ?? '').toISOString()).toBe('2026-08-03T15:00:00.000Z')
  })

  it('flags a capture containing two customers', () => {
    const value = parse(
      'Customer: Blanca Alcocer\nPhone: (555) 010-0410\nCustomer: Daniel Rountree\nPhone: (555) 010-0411',
    )

    expect(value.containsMultipleCustomers).toBe(true)
    expect(value.warnings).toContain('multiple_customers_detected')
  })

  it('flags a name it had to infer without a label', () => {
    const value = parse('Wanda Petrossian\n(555) 010-0310\nMidland, TX')

    expect(value.customer.fullName).toBe('Wanda Petrossian')
    expect(value.warnings).toContain('name_inferred_without_label')
    // An inferred name must not be confident enough to create on its own.
    expect(value.overallConfidence).toBeLessThan(0.75)
  })

  it('invents nothing when a field is absent', () => {
    const value = parse('Customer: Nobody Special')

    expect(value.customer.phone).toBeNull()
    expect(value.customer.email).toBeNull()
    expect(value.vehicleInterest.make).toBeNull()
  })

  it('degrades to a warning rather than throwing on unreadable text', () => {
    const result = parseOcrText('###')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.warnings).toContain('ocr_text_too_short')
      expect(result.value.overallConfidence).toBe(0)
    }
  })

  it('does not mistake a stock number for a phone number', () => {
    const value = parse('Customer: Wanda Petrossian\nStock: STK-49110')

    expect(value.customer.phone).toBeNull()
  })

  it('scores a capture with a customer ID higher than one without', () => {
    const withId = parse('Customer: A Person\nID: RV-100999\nPhone: (555) 010-0999')
    const withoutId = parse('Customer: A Person\nPhone: (555) 010-0999')

    expect(withId.overallConfidence).toBeGreaterThan(withoutId.overallConfidence)
  })

  it('strips control characters from hostile OCR output', () => {
    const value = parse('Customer: Jesus\u0000 Ayala\nPhone: (555) 010-0114')

    expect(value.customer.fullName).toBe('Jesus Ayala')
  })
})
