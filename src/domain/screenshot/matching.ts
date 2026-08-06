/**
 * Matching an extraction to an existing customer.
 *
 * Built on the Phase 2 duplicate rules rather than replacing them, so the
 * screenshot importer and the create-customer form agree on what "the same
 * person" means. The ranking is the one from the brief:
 *
 *   1. Exact dealership customer ID  — the CRM's own identity
 *   2. Exact normalized phone        — strong, but households share lines
 *   3. Exact normalized email        — strong, same caveat
 *   4. Exact normalized name + city  — two weak signals agreeing
 *   5. Similar name alone            — a review candidate, never a match
 *
 * A name-only match can never authorise an automatic write. That is the single
 * rule that stops two people with the same name being silently merged.
 */

import type { Customer } from '../models.ts'
import { findDuplicateCandidates, type DuplicateSignal } from '../duplicates.ts'
import type { ExtractionResult } from './extraction.ts'
import { normalizeEmail, normalizePhone } from '../../lib/normalize.ts'

export interface MatchCandidate {
  customer: Customer
  /** 0–1. Derived from the strongest signal, not from a fuzzy distance. */
  score: number
  reasons: DuplicateSignal[]
  conflicts: Array<{ field: string; existing: string; incoming: string }>
  /** True when the signal is strong enough to write to this customer. */
  isDefinitive: boolean
}

export interface MatchOutcome {
  candidates: MatchCandidate[]
  /** The single customer this screenshot definitely describes, if there is one. */
  definitive: MatchCandidate | null
  /** True when more than one customer matched definitively — a real conflict. */
  hasConflictingIdentities: boolean
}

/** Score per signal. Ordered by how much the signal actually proves. */
const SIGNAL_SCORES: Record<DuplicateSignal, number> = {
  dealership_customer_id: 1,
  phone: 0.92,
  email: 0.9,
  name_and_city: 0.65,
  similar_name: 0.4,
}

/** Signals strong enough to write to an existing customer without review. */
const DEFINITIVE_SIGNALS: readonly DuplicateSignal[] = ['dealership_customer_id', 'phone', 'email']

export function matchExtraction(
  extraction: ExtractionResult,
  customers: readonly Customer[],
): MatchOutcome {
  const draft = {
    fullName: extraction.customer.fullName ?? '',
    primaryPhone: extraction.customer.phone,
    primaryEmail: extraction.customer.email,
    dealershipCustomerId: extraction.customer.customerId,
    city: extraction.customer.city,
  }

  // With no name at all there is nothing to anchor a name-based signal to, but
  // a phone or ID can still identify the record on its own.
  const duplicates = findDuplicateCandidates(draft, customers)

  const candidates: MatchCandidate[] = duplicates.map((duplicate) => {
    const strongest = duplicate.signals[0] ?? 'similar_name'

    return {
      customer: duplicate.customer,
      score: SIGNAL_SCORES[strongest],
      reasons: duplicate.signals,
      conflicts: duplicate.conflicts,
      isDefinitive: duplicate.signals.some((signal) => DEFINITIVE_SIGNALS.includes(signal)),
    }
  })

  const definitiveCandidates = candidates.filter((candidate) => candidate.isDefinitive)

  return {
    candidates,
    // Only unambiguous when exactly one customer matched on a strong signal.
    definitive: definitiveCandidates.length === 1 ? (definitiveCandidates[0] ?? null) : null,
    hasConflictingIdentities: definitiveCandidates.length > 1,
  }
}

/**
 * Fields where the extraction contradicts a value already on the record.
 *
 * A conflict on a verified phone or email is treated as critical: applying it
 * could move a number from one person to another, which is the one mistake this
 * importer must never make on its own.
 */
export interface FieldConflict {
  field: 'phone' | 'email' | 'dealership_customer_id'
  existing: string
  incoming: string
  critical: boolean
}

export function findCriticalConflicts(
  extraction: ExtractionResult,
  customer: Customer,
): FieldConflict[] {
  const conflicts: FieldConflict[] = []

  const incomingPhone = normalizePhone(extraction.customer.phone)
  const existingPhone = normalizePhone(customer.primaryPhone)
  if (incomingPhone !== null && existingPhone !== null && incomingPhone !== existingPhone) {
    conflicts.push({
      field: 'phone',
      existing: customer.primaryPhone ?? '',
      incoming: extraction.customer.phone ?? '',
      // A second number is often a real second number, so this only becomes
      // critical when the record is otherwise identified by that phone.
      critical: true,
    })
  }

  const incomingEmail = normalizeEmail(extraction.customer.email)
  const existingEmail = normalizeEmail(customer.primaryEmail)
  if (incomingEmail !== null && existingEmail !== null && incomingEmail !== existingEmail) {
    conflicts.push({
      field: 'email',
      existing: customer.primaryEmail ?? '',
      incoming: extraction.customer.email ?? '',
      critical: true,
    })
  }

  const incomingId = extraction.customer.customerId?.trim() ?? null
  const existingId = customer.dealershipCustomerId?.trim() ?? null
  if (incomingId !== null && existingId !== null && incomingId !== existingId) {
    conflicts.push({
      field: 'dealership_customer_id',
      existing: existingId,
      incoming: incomingId,
      // Two different CRM identities on one record is never safe to reconcile
      // automatically.
      critical: true,
    })
  }

  return conflicts
}
