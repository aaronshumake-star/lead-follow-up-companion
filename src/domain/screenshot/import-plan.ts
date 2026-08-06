/**
 * Turns a decision plus an extraction into the concrete writes to perform.
 *
 * Pure, so both storage backends execute identical semantics and the whole
 * thing is testable without a database. The rules that matter:
 *
 *   - An existing value is never overwritten by an extracted one. A screenshot
 *     fills gaps; it does not correct a record a person already curated.
 *   - Contact methods are availability only, and arrive unverified. Nothing
 *     here can mark a channel as personally attempted.
 *   - Visible CRM activity is imported with performedByUser false, always.
 */

import type { Customer, CustomerContactMethod, VehicleInterest } from '../models.ts'
import type { ExtractionResult } from './extraction.ts'
import type { ImportDecision } from './decision-engine.ts'
import type { CustomerDraft, CustomerPatch } from '../../data/workspace.ts'
import { normalizeEmail, normalizePhone } from '../../lib/normalize.ts'
import type { ActivityType, ContactMethod } from '../vocabulary.ts'

export interface PlannedContactMethod {
  method: ContactMethod
  value: string
  /** Low-confidence channels are stored but flagged, never trusted for matching. */
  verified: boolean
}

export interface PlannedActivity {
  type: ActivityType
  direction: 'outbound' | 'inbound' | 'internal'
  occurredAt: string | null
  summary: string
}

export interface ImportPlan {
  /** Present for AUTO_CREATE. */
  createDraft: CustomerDraft | null
  /** Present for the update decisions; only ever fills empty fields. */
  updatePatch: CustomerPatch | null
  contactMethods: PlannedContactMethod[]
  vehicle: Omit<VehicleInterest, 'id' | 'customerId'> | null
  activities: PlannedActivity[]
  /** Human-readable lines for the compact import summary. */
  changes: string[]
}

export interface PlanOptions {
  decision: ImportDecision
  extraction: ExtractionResult
  /** Null for AUTO_CREATE. */
  existing: Customer | null
  existingContactMethods: readonly CustomerContactMethod[]
  existingVehicles: readonly VehicleInterest[]
  /** Fields the operator chose to drop during review. */
  ignoredFields?: readonly string[]
}

export function buildImportPlan(options: PlanOptions): ImportPlan {
  const { extraction, existing, existingContactMethods, existingVehicles } = options
  const ignored = new Set(options.ignoredFields ?? [])
  const changes: string[] = []

  const customer = extraction.customer

  const createDraft: CustomerDraft | null =
    existing === null
      ? {
          fullName: customer.fullName ?? 'Unnamed customer',
          firstName: customer.firstName,
          lastName: customer.lastName,
          primaryPhone: ignored.has('phone') ? null : customer.phone,
          primaryEmail: ignored.has('email') ? null : customer.email,
          dealershipCustomerId: ignored.has('customerId') ? null : customer.customerId,
          city: customer.city,
          state: customer.state,
          preferredLanguage: customer.preferredLanguage ?? 'unknown',
          leadSource: extraction.leadSource,
          salesperson: extraction.salesperson,
          leadStatus: extraction.leadStatus ?? 'new',
          notes: null,
        }
      : null

  if (createDraft !== null) changes.push('Customer created')

  // Only fill gaps. A screenshot is a weaker source than a record someone
  // already edited by hand, so it never overwrites an existing value.
  const updatePatch: CustomerPatch | null = existing === null ? null : {}

  if (existing !== null && updatePatch !== null) {
    const fill = <K extends keyof CustomerPatch>(
      key: K,
      current: string | null,
      incoming: string | null,
      label: string,
    ) => {
      if (incoming === null || current !== null) return
      updatePatch[key] = incoming as CustomerPatch[K]
      changes.push(label)
    }

    if (!ignored.has('phone')) fill('primaryPhone', existing.primaryPhone, customer.phone, 'Phone added')
    if (!ignored.has('email')) fill('primaryEmail', existing.primaryEmail, customer.email, 'Email added')
    if (!ignored.has('customerId')) {
      fill(
        'dealershipCustomerId',
        existing.dealershipCustomerId,
        customer.customerId,
        'Dealership ID added',
      )
    }
    fill('city', existing.city, customer.city, 'City added')
    fill('state', existing.state, customer.state, 'State added')
    fill('leadSource', existing.leadSource, extraction.leadSource, 'Lead source added')
    fill('salesperson', existing.salesperson, extraction.salesperson, 'Salesperson added')

    if (existing.preferredLanguage === 'unknown' && customer.preferredLanguage !== null) {
      updatePatch.preferredLanguage = customer.preferredLanguage
      changes.push('Preferred language added')
    }
  }

  // --- contact methods ------------------------------------------------------
  const known = new Set(
    existingContactMethods.map((method) => `${method.method}:${normalizeForCompare(method.method, method.value)}`),
  )

  const contactMethods: PlannedContactMethod[] = []
  const addedLabels: string[] = []

  for (const candidate of extraction.availableContactMethods) {
    if (!candidate.available) continue
    if (ignored.has(`contact_method.${candidate.method}`)) continue

    const value = candidate.value ?? fallbackValueFor(candidate.method, extraction)
    if (value === null) continue

    const key = `${candidate.method}:${normalizeForCompare(candidate.method, value)}`
    if (known.has(key)) continue
    known.add(key)

    contactMethods.push({
      method: candidate.method,
      value,
      // Below this the channel exists but nobody has confirmed it.
      verified: candidate.confidence >= 0.8,
    })
    addedLabels.push(CONTACT_LABELS[candidate.method])
  }

  if (addedLabels.length > 0) changes.push(`${addedLabels.join(' and ')} available`)

  // --- vehicle --------------------------------------------------------------
  const interest = extraction.vehicleInterest
  const hasVehicle =
    interest.make !== null ||
    interest.model !== null ||
    interest.floorplan !== null ||
    interest.stockNumber !== null ||
    interest.year !== null

  const duplicateVehicle = existingVehicles.some(
    (vehicle) =>
      vehicle.stockNumber !== null &&
      interest.stockNumber !== null &&
      vehicle.stockNumber.trim().toLowerCase() === interest.stockNumber.trim().toLowerCase(),
  )

  const vehicle =
    hasVehicle && !duplicateVehicle && !ignored.has('vehicle')
      ? {
          modelYear: interest.year,
          make: interest.make,
          model: interest.model,
          floorplan: interest.floorplan,
          stockNumber: interest.stockNumber,
          condition: interest.newOrUsed ?? 'unknown',
          isPrimary: existingVehicles.length === 0,
          notes: null,
        }
      : null

  if (vehicle !== null) {
    changes.push(
      `${[interest.year, interest.make, interest.model].filter((part) => part !== null).join(' ') || 'Unit'} added`,
    )
  }

  // --- visible activity -----------------------------------------------------
  // Recorded as evidence of what the CRM shows, never as something I did.
  const activities: PlannedActivity[] = extraction.visibleActivities
    .filter((activity) => activity.confidence >= 0.5)
    .slice(0, 10)
    .map((activity) => ({
      type: activity.type,
      direction: activity.direction,
      occurredAt: activity.occurredAt,
      summary: activity.summary === '' ? 'Seen in a CRM screenshot' : activity.summary,
    }))

  if (activities.length > 0) {
    changes.push(`${activities.length} CRM activit${activities.length === 1 ? 'y' : 'ies'} recorded`)
  }

  return { createDraft, updatePatch, contactMethods, vehicle, activities, changes }
}

const CONTACT_LABELS: Record<ContactMethod, string> = {
  phone_call: 'Phone',
  sms: 'SMS',
  email: 'Email',
  whatsapp: 'WhatsApp',
  voicemail: 'Voicemail',
  in_person: 'In person',
  other: 'Other',
}

function fallbackValueFor(method: ContactMethod, extraction: ExtractionResult): string | null {
  if (method === 'email') return extraction.customer.email
  if (method === 'in_person' || method === 'other') return null
  return extraction.customer.phone
}

function normalizeForCompare(method: ContactMethod, value: string): string {
  if (method === 'email') return normalizeEmail(value) ?? value.trim().toLowerCase()
  if (method === 'in_person' || method === 'other') return value.trim().toLowerCase()
  return normalizePhone(value) ?? value.trim()
}

/** Applies operator corrections over an extraction before it is planned. */
export function applyCorrections(
  extraction: ExtractionResult,
  corrections: Partial<{
    fullName: string | null
    phone: string | null
    email: string | null
    customerId: string | null
    city: string | null
    state: string | null
  }> = {},
): ExtractionResult {
  const corrected: ExtractionResult = structuredClone(extraction)

  for (const [key, value] of Object.entries(corrections)) {
    if (value === undefined) continue
    const trimmed = typeof value === 'string' ? value.trim() : null
    const next = trimmed === '' ? null : trimmed

    switch (key) {
      case 'fullName':
        corrected.customer.fullName = next
        break
      case 'phone':
        corrected.customer.phone = next
        break
      case 'email':
        corrected.customer.email = next
        break
      case 'customerId':
        corrected.customer.customerId = next
        break
      case 'city':
        corrected.customer.city = next
        break
      case 'state':
        corrected.customer.state = next === null ? null : next.toUpperCase()
        break
      default:
        break
    }
  }

  // A corrected phone or email is typed by a person, so the channel derived
  // from it is trustworthy in a way an OCR guess was not.
  corrected.availableContactMethods = corrected.availableContactMethods.map((method) => {
    if (method.method === 'email' && corrections.email !== undefined) {
      return { ...method, value: corrected.customer.email, confidence: 1 }
    }
    if (method.method !== 'email' && corrections.phone !== undefined) {
      return { ...method, value: corrected.customer.phone, confidence: 1 }
    }
    return method
  })

  return corrected
}
