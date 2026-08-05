/**
 * Normalization used for customer matching and de-duplication.
 *
 * These functions must stay behaviourally identical to public.normalize_name,
 * public.normalize_phone and public.normalize_email in
 * supabase/migrations/20260805000100_enums_and_helpers.sql, because the
 * database stores their output in generated columns while the client uses them
 * to decide whether a pasted screenshot describes someone already on file.
 * The parity is covered by tests in both places.
 */

/**
 * Collapses a display name to a comparison key: accents folded, punctuation and
 * runs of whitespace reduced to single spaces, lowercased.
 *
 * "  Jesús   Ayala-Ortíz " and "jesus ayala ortiz" collide, which is the point.
 */
export function normalizeName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null

  const folded = value
    .normalize('NFD')
    // Strip combining marks left behind by the decomposition.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  return folded === '' ? null : folded
}

/**
 * Reduces a phone number to digits, dropping a North-American country code so
 * that "+1 (555) 010-2233" and "555-010-2233" are recognised as one number.
 *
 * Numbers that are not 10 or 11 digits are kept as-is rather than guessed at;
 * an international number should still match itself.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null

  const digits = value.replace(/\D/g, '')
  if (digits === '') return null
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)

  return digits
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null

  const trimmed = value.trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

/**
 * Splits a full name into first and last for CRM screenshots that only give one
 * field. Handles the "Last, First" ordering some CRM list views use.
 *
 * Deliberately simple: it feeds an editable form, not an automatic write.
 */
export function splitFullName(fullName: string): { firstName: string | null; lastName: string | null } {
  const cleaned = fullName.replace(/\s+/g, ' ').trim()
  if (cleaned === '') return { firstName: null, lastName: null }

  if (cleaned.includes(',')) {
    const [last = '', first = ''] = cleaned.split(',', 2).map((part) => part.trim())
    return {
      firstName: first === '' ? null : first,
      lastName: last === '' ? null : last,
    }
  }

  const parts = cleaned.split(' ')
  if (parts.length === 1) return { firstName: parts[0] ?? null, lastName: null }

  return {
    firstName: parts[0] ?? null,
    lastName: parts.slice(1).join(' '),
  }
}

/**
 * Formats a normalized 10-digit number for display. Anything else is returned
 * untouched rather than mangled into a shape it does not have.
 */
export function formatPhoneForDisplay(value: string | null | undefined): string {
  const digits = normalizePhone(value)
  if (digits === null) return ''
  if (digits.length !== 10) return value?.trim() ?? ''

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/**
 * Converts a phone number to E.164 for the messaging provider, assuming +1 when
 * no country code is present. Returns null when the input cannot be a number,
 * so callers cannot accidentally send to a malformed destination.
 */
export function toE164(value: string | null | undefined, defaultCountryCode = '1'): string | null {
  if (value === null || value === undefined) return null

  const trimmed = value.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (digits === '') return null

  const withCountry = hasPlus || digits.length > 10 ? digits : `${defaultCountryCode}${digits}`
  if (withCountry.length < 8 || withCountry.length > 15) return null
  if (withCountry.startsWith('0')) return null

  return `+${withCountry}`
}

export function isE164(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value)
}
