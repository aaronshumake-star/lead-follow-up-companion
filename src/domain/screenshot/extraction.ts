/**
 * The structured result of reading a CRM screenshot.
 *
 * Everything here originated in an image the application cannot vouch for, so
 * the schema is the boundary: OCR output is parsed, validated and only then
 * allowed near domain logic. Anything malformed produces a validation failure
 * rather than a partially-populated object, because a half-read extraction is
 * how a phone number ends up attached to the wrong person.
 *
 * Two rules are encoded in the types rather than left to convention:
 *
 *   - `performedByCurrentUser` is `boolean | null`, and null means *unknown*.
 *     Activity visible in a CRM is not evidence that I did it, so the importer
 *     only ever records a personal attempt when this is explicitly true.
 *   - Every field carries a confidence, so the decision engine can tell the
 *     difference between "the name is Ayala" and "the name might be Ayala".
 */

import { z } from 'zod'
import {
  ACTIVITY_DIRECTIONS,
  ACTIVITY_TYPES,
  CONTACT_METHODS,
  LEAD_STATUSES,
  PREFERRED_LANGUAGES,
  VEHICLE_CONDITIONS,
} from '../vocabulary.ts'

/** Longer than any plausible CRM field; a cheap guard against runaway OCR. */
const MAX_FIELD_LENGTH = 200
const MAX_SUMMARY_LENGTH = 500

const confidence = z.number().min(0).max(1)

/** Trims, collapses whitespace and treats an empty result as absent. */
const extractedText = z
  .string()
  .max(MAX_FIELD_LENGTH)
  .transform((value) => {
    const cleaned = value.replace(/\s+/g, ' ').trim()
    return cleaned === '' ? null : cleaned
  })
  .nullable()

export const extractedCustomerSchema = z.object({
  fullName: extractedText.default(null),
  firstName: extractedText.default(null),
  lastName: extractedText.default(null),
  phone: extractedText.default(null),
  email: extractedText.default(null),
  city: extractedText.default(null),
  state: extractedText.default(null),
  customerId: extractedText.default(null),
  preferredLanguage: z.enum(PREFERRED_LANGUAGES).nullable().default(null),
})

export const extractedContactMethodSchema = z.object({
  method: z.enum(CONTACT_METHODS),
  available: z.boolean(),
  value: extractedText.default(null),
  confidence: confidence.default(0),
})

export const extractedActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  direction: z.enum(ACTIVITY_DIRECTIONS),
  /**
   * Tri-state on purpose. `null` means the screenshot does not say who did it,
   * which is the usual case and must never be read as "yes".
   */
  performedByCurrentUser: z.boolean().nullable().default(null),
  occurredAt: z.string().datetime({ offset: true }).nullable().default(null),
  summary: z.string().max(MAX_SUMMARY_LENGTH).default(''),
  confidence: confidence.default(0),
})

export const extractedVehicleSchema = z.object({
  year: z.number().int().min(1950).max(2100).nullable().default(null),
  make: extractedText.default(null),
  model: extractedText.default(null),
  floorplan: extractedText.default(null),
  stockNumber: extractedText.default(null),
  newOrUsed: z.enum(VEHICLE_CONDITIONS).nullable().default(null),
})

export const extractionResultSchema = z.object({
  customer: extractedCustomerSchema,
  availableContactMethods: z.array(extractedContactMethodSchema).max(20).default([]),
  visibleActivities: z.array(extractedActivitySchema).max(50).default([]),
  vehicleInterest: extractedVehicleSchema,
  leadStatus: z.enum(LEAD_STATUSES).nullable().default(null),
  salesperson: extractedText.default(null),
  leadSource: extractedText.default(null),
  overallConfidence: confidence.default(0),
  /** True when more than one person appears; the importer refuses to guess. */
  containsMultipleCustomers: z.boolean().default(false),
  warnings: z.array(z.string().max(200)).max(50).default([]),
})

export type ExtractionResult = z.infer<typeof extractionResultSchema>
export type ExtractedCustomer = z.infer<typeof extractedCustomerSchema>
export type ExtractedContactMethod = z.infer<typeof extractedContactMethodSchema>
export type ExtractedActivity = z.infer<typeof extractedActivitySchema>
export type ExtractedVehicle = z.infer<typeof extractedVehicleSchema>

export type ExtractionValidation =
  | { ok: true; value: ExtractionResult }
  | { ok: false; issues: string[] }

/**
 * The single gate between OCR output and domain logic.
 *
 * Never throws: an unreadable or malformed result is an expected outcome of
 * pointing a camera at a spreadsheet, and it has to degrade into
 * EXTRACTION_FAILED rather than an unhandled error.
 */
export function validateExtraction(candidate: unknown): ExtractionValidation {
  const parsed = extractionResultSchema.safeParse(candidate)

  if (parsed.success) return { ok: true, value: parsed.data }

  return {
    ok: false,
    // Paths only. Values could contain customer data and must not reach a log.
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.code}`),
  }
}

/** An empty result, used as the starting point for the parser. */
export function emptyExtraction(): ExtractionResult {
  return {
    customer: {
      fullName: null,
      firstName: null,
      lastName: null,
      phone: null,
      email: null,
      city: null,
      state: null,
      customerId: null,
      preferredLanguage: null,
    },
    availableContactMethods: [],
    visibleActivities: [],
    vehicleInterest: {
      year: null,
      make: null,
      model: null,
      floorplan: null,
      stockNumber: null,
      newOrUsed: null,
    },
    leadStatus: null,
    salesperson: null,
    leadSource: null,
    overallConfidence: 0,
    containsMultipleCustomers: false,
    warnings: [],
  }
}
