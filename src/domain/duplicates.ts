/**
 * Conservative duplicate detection.
 *
 * The app warns; it never merges. Two people can share a household phone, a
 * surname, or a town, and silently folding them together loses a lead more
 * thoroughly than a duplicate ever could.
 *
 * Signals are ranked by how much they actually prove:
 *
 *   1. Dealership customer ID — the CRM's own identity, so an exact match is
 *      the same person.
 *   2. Normalized phone — strong, but a household can share a line.
 *   3. Normalized email — strong, same caveat.
 *   4. Normalized name plus city — circumstantial, two signals agreeing.
 *   5. Similar name alone — a warning only, never treated as confident.
 */

import type { Customer } from './models.ts'
import { normalizeEmail, normalizeName, normalizePhone } from '../lib/normalize.ts'

export const DUPLICATE_SIGNALS = [
  'dealership_customer_id',
  'phone',
  'email',
  'name_and_city',
  'similar_name',
] as const
export type DuplicateSignal = (typeof DUPLICATE_SIGNALS)[number]

export const DUPLICATE_SIGNAL_LABELS: Record<DuplicateSignal, string> = {
  dealership_customer_id: 'Same dealership customer ID',
  phone: 'Same phone number',
  email: 'Same email address',
  name_and_city: 'Same name and city',
  similar_name: 'Similar name',
}

/** Ranked strongest first; index doubles as the ordering key. */
const SIGNAL_RANK: readonly DuplicateSignal[] = [
  'dealership_customer_id',
  'phone',
  'email',
  'name_and_city',
  'similar_name',
]

export type DuplicateConfidence = 'certain' | 'strong' | 'possible'

export interface DuplicateCandidate {
  customer: Customer
  signals: DuplicateSignal[]
  confidence: DuplicateConfidence
  /** Fields where the draft and the existing record disagree. */
  conflicts: Array<{ field: string; existing: string; incoming: string }>
}

export interface CustomerIdentityDraft {
  fullName: string
  primaryPhone?: string | null
  primaryEmail?: string | null
  dealershipCustomerId?: string | null
  city?: string | null
}

/**
 * Finds records the draft might duplicate.
 *
 * `excludeId` skips the record being edited, so editing a customer never warns
 * that it matches itself.
 */
export function findDuplicateCandidates(
  draft: CustomerIdentityDraft,
  customers: readonly Customer[],
  excludeId?: string,
): DuplicateCandidate[] {
  const draftName = normalizeName(draft.fullName)
  const draftPhone = normalizePhone(draft.primaryPhone)
  const draftEmail = normalizeEmail(draft.primaryEmail)
  const draftDealerId = trimmedOrNull(draft.dealershipCustomerId)
  const draftCity = normalizeName(draft.city)

  const candidates: DuplicateCandidate[] = []

  for (const customer of customers) {
    if (customer.id === excludeId) continue

    const signals: DuplicateSignal[] = []

    if (draftDealerId !== null && trimmedOrNull(customer.dealershipCustomerId) === draftDealerId) {
      signals.push('dealership_customer_id')
    }
    if (draftPhone !== null && normalizePhone(customer.primaryPhone) === draftPhone) {
      signals.push('phone')
    }
    if (draftEmail !== null && normalizeEmail(customer.primaryEmail) === draftEmail) {
      signals.push('email')
    }

    const existingName = normalizeName(customer.fullName)
    const namesMatch = draftName !== null && existingName === draftName

    if (namesMatch && draftCity !== null && normalizeName(customer.city) === draftCity) {
      signals.push('name_and_city')
    }

    // A bare name match is the weakest evidence there is, so it only ever
    // appears when nothing stronger did.
    if (signals.length === 0 && namesMatch) {
      signals.push('similar_name')
    }

    if (signals.length === 0) continue

    candidates.push({
      customer,
      signals: sortSignals(signals),
      confidence: confidenceFor(signals),
      conflicts: findConflicts(draft, customer),
    })
  }

  return candidates.sort(
    (a, b) => SIGNAL_RANK.indexOf(a.signals[0] ?? 'similar_name') - SIGNAL_RANK.indexOf(b.signals[0] ?? 'similar_name'),
  )
}

function sortSignals(signals: DuplicateSignal[]): DuplicateSignal[] {
  return [...signals].sort((a, b) => SIGNAL_RANK.indexOf(a) - SIGNAL_RANK.indexOf(b))
}

function confidenceFor(signals: readonly DuplicateSignal[]): DuplicateConfidence {
  if (signals.includes('dealership_customer_id')) return 'certain'
  if (signals.includes('phone') || signals.includes('email')) return 'strong'
  return 'possible'
}

/**
 * Fields where the draft disagrees with the existing record. Surfacing these
 * lets the operator see *why* the two might be different people before deciding.
 */
function findConflicts(
  draft: CustomerIdentityDraft,
  customer: Customer,
): Array<{ field: string; existing: string; incoming: string }> {
  const conflicts: Array<{ field: string; existing: string; incoming: string }> = []

  const compare = (field: string, existing: string | null, incoming: string | null | undefined) => {
    const left = trimmedOrNull(existing)
    const right = trimmedOrNull(incoming ?? null)
    if (left !== null && right !== null && left.toLowerCase() !== right.toLowerCase()) {
      conflicts.push({ field, existing: left, incoming: right })
    }
  }

  compare('Full name', customer.fullName, draft.fullName)
  compare('Phone', customer.primaryPhone, draft.primaryPhone)
  compare('Email', customer.primaryEmail, draft.primaryEmail)
  compare('Dealership ID', customer.dealershipCustomerId, draft.dealershipCustomerId)
  compare('City', customer.city, draft.city)

  return conflicts
}

function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
