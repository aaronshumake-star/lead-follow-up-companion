/**
 * The decision engine.
 *
 * One pure function decides what happens to a screenshot. It is deterministic
 * and takes its clock and its data as arguments, so every branch is testable
 * without a database, a network, or a real image.
 *
 * The design principle is that review is a cost, not a safety net. Requiring a
 * human to approve every screenshot would make the app slower than the CRM it
 * exists to compensate for, so the engine writes automatically whenever
 * identity is genuinely clear, and escalates only when applying the extraction
 * could combine two different people or produce a record built on a guess.
 */

import type { Customer } from '../models.ts'
import type { ExtractionResult } from './extraction.ts'
import {
  findCriticalConflicts,
  matchExtraction,
  type FieldConflict,
  type MatchCandidate,
  type MatchOutcome,
} from './matching.ts'

export const IMPORT_DECISIONS = [
  'AUTO_CREATE',
  'AUTO_UPDATE',
  'SAVE_WITH_UNVERIFIED_FIELDS',
  'NEEDS_MATCH_REVIEW',
  'NEEDS_CONFLICT_REVIEW',
  'EXTRACTION_FAILED',
  'DUPLICATE_IGNORED',
] as const
export type ImportDecision = (typeof IMPORT_DECISIONS)[number]

/**
 * Confidence a name must reach before it can create a customer on its own.
 * Below this the record would be built on a guess, and a wrong customer is
 * harder to notice than a missing one.
 */
export const MIN_AUTO_CREATE_CONFIDENCE = 0.6

/** Confidence below which nothing usable was read at all. */
export const MIN_USABLE_CONFIDENCE = 0.25

/** Fields under this confidence are saved but flagged unverified. */
export const UNVERIFIED_FIELD_THRESHOLD = 0.75

export interface DecisionInput {
  extraction: ExtractionResult
  customers: readonly Customer[]
  /** True when this exact image hash has already been processed. */
  isDuplicateHash: boolean
  /** False when OCR itself failed; the extraction is then meaningless. */
  extractionValid: boolean
}

export interface DecisionOutput {
  decision: ImportDecision
  /** Short, non-identifying explanation, safe for a log line or a list row. */
  reason: string
  /** The customer to write to, for AUTO_UPDATE and SAVE_WITH_UNVERIFIED_FIELDS. */
  targetCustomer: Customer | null
  candidates: MatchCandidate[]
  conflicts: FieldConflict[]
  /** Field keys saved without verification because confidence was low. */
  unverifiedFields: string[]
  warnings: string[]
  /** True when the outcome needs a person before anything is written. */
  requiresReview: boolean
}

export function decideImport(input: DecisionInput): DecisionOutput {
  const { extraction, customers, isDuplicateHash, extractionValid } = input

  // Cheapest check first: a re-paste of the same image costs nothing to ignore.
  if (isDuplicateHash) {
    return base('DUPLICATE_IGNORED', 'This exact screenshot has already been imported.', {
      requiresReview: false,
    })
  }

  if (!extractionValid) {
    return base('EXTRACTION_FAILED', 'The extracted data could not be validated.', {
      requiresReview: true,
      warnings: ['extraction_invalid'],
    })
  }

  if (extraction.overallConfidence < MIN_USABLE_CONFIDENCE || extraction.customer.fullName === null) {
    const hasStrongIdentifier =
      extraction.customer.customerId !== null ||
      extraction.customer.phone !== null ||
      extraction.customer.email !== null

    // A crisp customer ID with an unreadable name is still workable, because
    // the ID alone identifies the record.
    if (!hasStrongIdentifier) {
      return base('EXTRACTION_FAILED', 'No readable customer identity in this screenshot.', {
        requiresReview: true,
        warnings: [...extraction.warnings, 'no_identity'],
      })
    }
  }

  const match = matchExtraction(extraction, customers)

  // Two customers identified by strong signals means applying this would merge
  // them. Never automatic.
  if (match.hasConflictingIdentities) {
    return base('NEEDS_CONFLICT_REVIEW', 'Exact identifiers point to more than one customer.', {
      requiresReview: true,
      candidates: match.candidates,
      warnings: [...extraction.warnings, 'conflicting_identities'],
    })
  }

  if (extraction.containsMultipleCustomers) {
    return base('NEEDS_CONFLICT_REVIEW', 'More than one customer appears in this screenshot.', {
      requiresReview: true,
      candidates: match.candidates,
      warnings: [...extraction.warnings, 'multiple_customers'],
    })
  }

  if (match.definitive !== null) {
    return decideForExistingCustomer(extraction, match.definitive, match)
  }

  return decideForNewCustomer(extraction, match)
}

/** A strong signal identified exactly one customer: update, unless it conflicts. */
function decideForExistingCustomer(
  extraction: ExtractionResult,
  target: MatchCandidate,
  match: MatchOutcome,
): DecisionOutput {
  const conflicts = findCriticalConflicts(extraction, target.customer)
  const critical = conflicts.filter((conflict) => conflict.critical)

  if (critical.length > 0) {
    return base('NEEDS_CONFLICT_REVIEW', 'A verified identifier disagrees with this screenshot.', {
      requiresReview: true,
      targetCustomer: target.customer,
      candidates: match.candidates,
      conflicts,
      warnings: [...extraction.warnings, 'critical_field_conflict'],
    })
  }

  const unverified = collectUnverifiedFields(extraction)

  if (unverified.length > 0) {
    // Identity is settled, so the uncertain fields are noncritical by
    // definition — saving them flagged cannot attach this record to anyone else.
    return base(
      'SAVE_WITH_UNVERIFIED_FIELDS',
      'Customer identified; some fields saved as unverified.',
      {
        requiresReview: false,
        targetCustomer: target.customer,
        candidates: match.candidates,
        unverifiedFields: unverified,
        warnings: extraction.warnings,
      },
    )
  }

  return base('AUTO_UPDATE', 'Matched an existing customer on an exact identifier.', {
    requiresReview: false,
    targetCustomer: target.customer,
    candidates: match.candidates,
    warnings: extraction.warnings,
  })
}

/** Nothing matched strongly: create, unless the only signal is a name. */
function decideForNewCustomer(extraction: ExtractionResult, match: MatchOutcome): DecisionOutput {
  const weakCandidates = match.candidates.filter((candidate) => !candidate.isDefinitive)

  // A name-only match is exactly the case where two real people get merged, so
  // it always goes to a person.
  if (weakCandidates.length > 0) {
    return base('NEEDS_MATCH_REVIEW', 'Only a name matches an existing customer.', {
      requiresReview: true,
      candidates: match.candidates,
      warnings: [...extraction.warnings, 'name_only_match'],
    })
  }

  if (extraction.customer.fullName === null) {
    return base('NEEDS_MATCH_REVIEW', 'No name was read, so a new customer cannot be created.', {
      requiresReview: true,
      candidates: match.candidates,
      warnings: [...extraction.warnings, 'no_name_for_create'],
    })
  }

  if (extraction.overallConfidence < MIN_AUTO_CREATE_CONFIDENCE) {
    return base('NEEDS_MATCH_REVIEW', 'The extracted name is not confident enough to create.', {
      requiresReview: true,
      candidates: match.candidates,
      warnings: [...extraction.warnings, 'low_confidence_name'],
    })
  }

  const unverified = collectUnverifiedFields(extraction)

  return base('AUTO_CREATE', 'A new customer with no existing match.', {
    requiresReview: false,
    candidates: match.candidates,
    unverifiedFields: unverified,
    warnings: extraction.warnings,
  })
}

/**
 * Noncritical fields read with low confidence.
 *
 * Identity fields are deliberately absent: a phone or email is either good
 * enough to trust or it does not get written, because an unverified identifier
 * is exactly the thing that could later match the wrong person.
 */
function collectUnverifiedFields(extraction: ExtractionResult): string[] {
  const unverified: string[] = []

  for (const method of extraction.availableContactMethods) {
    if (method.confidence < UNVERIFIED_FIELD_THRESHOLD) {
      unverified.push(`contact_method.${method.method}`)
    }
  }

  if (extraction.vehicleInterest.make !== null && extraction.overallConfidence < UNVERIFIED_FIELD_THRESHOLD) {
    unverified.push('vehicle_interest')
  }

  if (extraction.warnings.includes('name_inferred_without_label')) {
    unverified.push('customer.full_name')
  }

  return unverified
}

function base(
  decision: ImportDecision,
  reason: string,
  overrides: Partial<Omit<DecisionOutput, 'decision' | 'reason'>>,
): DecisionOutput {
  return {
    decision,
    reason,
    targetCustomer: null,
    candidates: [],
    conflicts: [],
    unverifiedFields: [],
    warnings: [],
    requiresReview: false,
    ...overrides,
  }
}

export const DECISION_LABELS: Record<ImportDecision, string> = {
  AUTO_CREATE: 'Customer created',
  AUTO_UPDATE: 'Existing customer updated',
  SAVE_WITH_UNVERIFIED_FIELDS: 'Updated, some fields unverified',
  NEEDS_MATCH_REVIEW: 'Needs review — which customer?',
  NEEDS_CONFLICT_REVIEW: 'Needs review — conflicting details',
  EXTRACTION_FAILED: 'Could not read this screenshot',
  DUPLICATE_IGNORED: 'Already imported',
}

/** Decisions that write without asking. */
export function isAutomatic(decision: ImportDecision): boolean {
  return (
    decision === 'AUTO_CREATE' ||
    decision === 'AUTO_UPDATE' ||
    decision === 'SAVE_WITH_UNVERIFIED_FIELDS'
  )
}
