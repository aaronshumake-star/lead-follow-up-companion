import { describe, expect, it } from 'vitest'
import {
  formatPhoneForDisplay,
  isE164,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  splitFullName,
  toE164,
} from './normalize.ts'

/**
 * These cases are duplicated in supabase/tests/01_rls_and_constraints.sql. The
 * database stores normalized values in generated columns while the client uses
 * these functions to decide whether a pasted screenshot describes someone
 * already on file, so the two implementations must not drift.
 */
describe('normalizeName', () => {
  it('folds accents, punctuation and spacing into one comparison key', () => {
    expect(normalizeName('  Jesús   Ayala-Ortíz ')).toBe('jesus ayala ortiz')
  })

  it('folds punctuation so apostrophes and hyphens stop mattering', () => {
    expect(normalizeName("Renata O'Connor")).toBe(normalizeName('Renata O Connor'))
  })

  it('preserves token order, so "Last, First" is not silently the same person', () => {
    // Reordering here would make unrelated people collide. Re-ordering a
    // "Last, First" CRM field is splitFullName's job, on data a human confirms.
    expect(normalizeName("O'Connor, Renata")).toBe('o connor renata')
    expect(normalizeName("O'Connor, Renata")).not.toBe(normalizeName("Renata O'Connor"))
  })

  it('returns null when nothing usable is left', () => {
    expect(normalizeName('   ')).toBeNull()
    expect(normalizeName('---')).toBeNull()
    expect(normalizeName(null)).toBeNull()
    expect(normalizeName(undefined)).toBeNull()
  })
})

describe('normalizePhone', () => {
  it('strips formatting and the North-American country code', () => {
    expect(normalizePhone('+1 (555) 010-0114')).toBe('5550100114')
    expect(normalizePhone('555.010.0114')).toBe('5550100114')
    expect(normalizePhone('1-555-010-0114')).toBe('5550100114')
  })

  it('collides formatted and unformatted versions of one number', () => {
    expect(normalizePhone('+1 (555) 010-0114')).toBe(normalizePhone('5550100114'))
  })

  it('leaves an international number alone rather than guessing at it', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('442079460958')
  })

  it('returns null when there are no digits', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('n/a')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Jesus.Ayala@Example.COM ')).toBe('jesus.ayala@example.com')
  })

  it('returns null for blank input', () => {
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
  })
})

describe('splitFullName', () => {
  it('splits a plain first and last name', () => {
    expect(splitFullName('Jesus Ayala')).toEqual({ firstName: 'Jesus', lastName: 'Ayala' })
  })

  it('handles the "Last, First" ordering CRM list views use', () => {
    expect(splitFullName('Ayala, Jesus')).toEqual({ firstName: 'Jesus', lastName: 'Ayala' })
  })

  it('keeps compound surnames together', () => {
    expect(splitFullName('Renata Okonkwo Adeyemi')).toEqual({
      firstName: 'Renata',
      lastName: 'Okonkwo Adeyemi',
    })
  })

  it('handles a single name and blank input', () => {
    expect(splitFullName('Cher')).toEqual({ firstName: 'Cher', lastName: null })
    expect(splitFullName('   ')).toEqual({ firstName: null, lastName: null })
  })
})

describe('formatPhoneForDisplay', () => {
  it('formats a ten-digit number', () => {
    expect(formatPhoneForDisplay('+15550100114')).toBe('(555) 010-0114')
  })

  it('returns anything else untouched rather than mangling it', () => {
    expect(formatPhoneForDisplay('+44 20 7946 0958')).toBe('+44 20 7946 0958')
    expect(formatPhoneForDisplay(null)).toBe('')
  })
})

describe('toE164', () => {
  it('assumes +1 for a bare ten-digit number', () => {
    expect(toE164('(555) 010-0114')).toBe('+15550100114')
  })

  it('keeps an explicit country code', () => {
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958')
  })

  it('refuses input that cannot be a destination number', () => {
    expect(toE164('12345')).toBeNull()
    expect(toE164('')).toBeNull()
    expect(toE164(null)).toBeNull()
  })
})

describe('isE164', () => {
  it('accepts canonical numbers only', () => {
    expect(isE164('+15550100114')).toBe(true)
    expect(isE164('15550100114')).toBe(false)
    expect(isE164('+0555010114')).toBe(false)
    expect(isE164(null)).toBe(false)
  })
})
