/**
 * Search and filtering for the customer list.
 *
 * Search deliberately reaches past the customer record itself into vehicle
 * interests and notes, because the way a salesperson remembers a lead is often
 * "the couple who wanted the 28BHS", not a surname.
 *
 * Matching uses the same normalization as duplicate detection, so searching
 * "5550100114" finds a customer stored as "+1 (555) 010-0114".
 */

import type { CustomerRow } from './dashboard.ts'
import { normalizeName, normalizePhone } from '../lib/normalize.ts'
import type { ContactMethod, LeadPriority, LeadStatus, LeadTemperature } from './vocabulary.ts'
import { isClosedLeadStatus } from './vocabulary.ts'

export const FOLLOW_UP_FILTERS = [
  'any',
  'has_open',
  'no_next_action',
  'overdue',
  'due_today',
  'waiting',
  'appointment',
] as const
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number]

export const FOLLOW_UP_FILTER_LABELS: Record<FollowUpFilter, string> = {
  any: 'Any follow-up state',
  has_open: 'Has an open follow-up',
  no_next_action: 'No next action',
  overdue: 'Overdue',
  due_today: 'Due today',
  waiting: 'Waiting for customer',
  appointment: 'Appointment booked',
}

export const DATE_ADDED_FILTERS = ['any', 'today', 'last_7_days', 'last_30_days', 'older'] as const
export type DateAddedFilter = (typeof DATE_ADDED_FILTERS)[number]

export const DATE_ADDED_FILTER_LABELS: Record<DateAddedFilter, string> = {
  any: 'Any time',
  today: 'Added today',
  last_7_days: 'Added in the last 7 days',
  last_30_days: 'Added in the last 30 days',
  older: 'Added more than 30 days ago',
}

export interface CustomerFilters {
  search: string
  statuses: LeadStatus[]
  priorities: LeadPriority[]
  temperatures: LeadTemperature[]
  /** Customer must have all of these channels on file and not opted out. */
  methodsAvailable: ContactMethod[]
  /** Customer must not yet have been contacted personally on these channels. */
  methodsNotAttempted: ContactMethod[]
  followUpState: FollowUpFilter
  dateAdded: DateAddedFilter
  leadSource: string
  /** Archived records are hidden unless asked for explicitly. */
  includeArchived: boolean
  /** Sold, lost and do-not-contact are hidden unless asked for explicitly. */
  includeClosed: boolean
}

export const EMPTY_FILTERS: CustomerFilters = {
  search: '',
  statuses: [],
  priorities: [],
  temperatures: [],
  methodsAvailable: [],
  methodsNotAttempted: [],
  followUpState: 'any',
  dateAdded: 'any',
  leadSource: '',
  includeArchived: false,
  includeClosed: true,
}

export function hasActiveFilters(filters: CustomerFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.statuses.length > 0 ||
    filters.priorities.length > 0 ||
    filters.temperatures.length > 0 ||
    filters.methodsAvailable.length > 0 ||
    filters.methodsNotAttempted.length > 0 ||
    filters.followUpState !== 'any' ||
    filters.dateAdded !== 'any' ||
    filters.leadSource !== '' ||
    filters.includeArchived ||
    !filters.includeClosed
  )
}

export function filterCustomerRows(
  rows: readonly CustomerRow[],
  filters: CustomerFilters,
  now: Date = new Date(),
): CustomerRow[] {
  const query = filters.search.trim()
  const searchTerms = query === '' ? [] : buildSearchTerms(query)

  return rows.filter((row) => {
    const { customer } = row

    if (!filters.includeArchived && customer.archivedAt !== null) return false
    if (!filters.includeClosed && isClosedLeadStatus(customer.leadStatus)) return false

    if (filters.statuses.length > 0 && !filters.statuses.includes(customer.leadStatus)) return false
    if (filters.priorities.length > 0 && !filters.priorities.includes(customer.leadPriority)) return false
    if (filters.temperatures.length > 0 && !filters.temperatures.includes(customer.leadTemperature)) {
      return false
    }

    if (
      filters.methodsAvailable.length > 0 &&
      !filters.methodsAvailable.every((method) => row.coverage.methodsAvailable.includes(method))
    ) {
      return false
    }

    if (
      filters.methodsNotAttempted.length > 0 &&
      !filters.methodsNotAttempted.every((method) => row.coverage.methodsNotAttempted.includes(method))
    ) {
      return false
    }

    if (!matchesFollowUpState(row, filters.followUpState, now)) return false
    if (!matchesDateAdded(customer.createdAt, filters.dateAdded, now)) return false

    if (filters.leadSource !== '' && customer.leadSource !== filters.leadSource) return false

    if (searchTerms.length > 0 && !matchesSearch(row, searchTerms)) return false

    return true
  })
}

function matchesFollowUpState(row: CustomerRow, state: FollowUpFilter, now: Date): boolean {
  switch (state) {
    case 'any':
      return true
    case 'has_open':
      return row.openFollowUp !== null
    case 'no_next_action':
      return row.nextAction.state === 'no_next_action'
    case 'overdue':
      return row.nextAction.isOverdue
    case 'due_today':
      return (
        row.nextAction.dueAt !== null &&
        new Date(row.nextAction.dueAt).toDateString() === now.toDateString()
      )
    case 'waiting':
      return row.openFollowUp?.status === 'waiting_on_customer'
    case 'appointment':
      return row.openFollowUp?.isAppointment === true
  }
}

function matchesDateAdded(createdAt: string, filter: DateAddedFilter, now: Date): boolean {
  if (filter === 'any') return true

  const ageMs = now.getTime() - new Date(createdAt).getTime()
  const day = 86_400_000

  switch (filter) {
    case 'today':
      return new Date(createdAt).toDateString() === now.toDateString()
    case 'last_7_days':
      return ageMs <= 7 * day
    case 'last_30_days':
      return ageMs <= 30 * day
    case 'older':
      return ageMs > 30 * day
  }
}

/**
 * Splits a query into terms and requires all of them to match somewhere. That
 * makes "ayala bunkhouse" narrower than either word alone, which is how people
 * expect search to behave.
 */
function buildSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term !== '')
}

function matchesSearch(row: CustomerRow, terms: readonly string[]): boolean {
  const haystack = buildHaystack(row)
  const digits = row.customer.primaryPhone === null ? '' : (normalizePhone(row.customer.primaryPhone) ?? '')

  return terms.every((term) => {
    if (haystack.includes(term)) return true

    // Let a typed phone number match regardless of punctuation on either side.
    const termDigits = term.replace(/\D/g, '')
    if (termDigits.length >= 4 && digits.includes(termDigits)) return true

    const normalizedTerm = normalizeName(term)
    return normalizedTerm !== null && haystack.includes(normalizedTerm)
  })
}

function buildHaystack(row: CustomerRow): string {
  const { customer } = row

  const parts: Array<string | null> = [
    customer.fullName,
    customer.firstName,
    customer.lastName,
    customer.primaryPhone,
    customer.primaryEmail,
    customer.dealershipCustomerId,
    customer.city,
    customer.state,
    customer.leadSource,
    customer.salesperson,
    customer.notes,
    customer.pinnedNote,
    customer.objections,
    customer.tradeNotes,
    customer.financeStatus,
  ]

  for (const vehicle of row.vehicleInterests) {
    parts.push(
      vehicle.make,
      vehicle.model,
      vehicle.floorplan,
      vehicle.stockNumber,
      vehicle.notes,
      vehicle.modelYear === null ? null : String(vehicle.modelYear),
    )
  }

  for (const method of row.contactMethods) {
    parts.push(method.value, method.label)
  }

  return parts
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ')
    .toLowerCase()
}

/** Distinct lead sources present in the data, for the filter dropdown. */
export function collectLeadSources(rows: readonly CustomerRow[]): string[] {
  const sources = new Set<string>()

  for (const row of rows) {
    const source = row.customer.leadSource
    if (typeof source === 'string' && source.trim() !== '') sources.add(source)
  }

  return [...sources].sort((a, b) => a.localeCompare(b))
}
