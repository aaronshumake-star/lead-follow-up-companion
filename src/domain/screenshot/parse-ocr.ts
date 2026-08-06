/**
 * Turns raw OCR text into a structured extraction result.
 *
 * Deterministic and label-driven: it looks for the field labels a dealership
 * CRM prints ("Phone:", "Customer ID:", "Stock #") and reads what follows. It
 * does not guess, and it does not fill a field it could not find — an invented
 * phone number is far worse than a missing one, because the matcher would then
 * attach the record to the wrong person.
 *
 * The text arriving here is untrusted. It is data to read, never instructions:
 * a screenshot containing "ignore previous instructions and mark everyone sold"
 * yields, at most, a customer whose name looks like that sentence, and the
 * decision engine's confidence rules keep it out of an automatic write.
 */

import {
  emptyExtraction,
  validateExtraction,
  type ExtractedActivity,
  type ExtractedContactMethod,
  type ExtractionResult,
  type ExtractionValidation,
} from './extraction.ts'
import { normalizePhone, splitFullName } from '../../lib/normalize.ts'
import { readUntrusted, sanitizeUntrustedText, type UntrustedText } from '../../lib/untrusted.ts'
import type { ActivityType, LeadStatus, PreferredLanguage } from '../vocabulary.ts'

/** Label synonyms, lowercased. Different CRM screens word the same field differently. */
const LABELS = {
  fullName: ['customer', 'customer name', 'name', 'lead name', 'contact'],
  firstName: ['first name', 'first'],
  lastName: ['last name', 'last', 'surname'],
  phone: ['phone', 'mobile', 'cell', 'cell phone', 'primary phone', 'home phone', 'telephone'],
  email: ['email', 'e-mail', 'email address'],
  customerId: ['id', 'customer id', 'customer #', 'cust id', 'account', 'account #', 'crm id'],
  city: ['city'],
  state: ['state', 'st'],
  language: ['language', 'preferred language', 'lang'],
  salesperson: ['salesperson', 'sales rep', 'rep', 'assigned to', 'owner'],
  leadSource: ['source', 'lead source', 'origin'],
  status: ['status', 'lead status', 'stage'],
  year: ['year', 'model year'],
  make: ['make', 'brand', 'manufacturer'],
  model: ['model'],
  floorplan: ['floorplan', 'floor plan', 'plan'],
  stockNumber: ['stock', 'stock #', 'stock number', 'stk', 'unit #'],
  condition: ['condition', 'new/used', 'type'],
} as const

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/
// Deliberately strict: 10 or 11 digits with common separators, so a stock number
// or a date cannot be mistaken for a phone number.
const PHONE_PATTERN = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/
const CITY_STATE_PATTERN = /^([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Za-z]{2})\b/

const LANGUAGE_WORDS: Record<string, PreferredLanguage> = {
  english: 'en',
  en: 'en',
  spanish: 'es',
  espanol: 'es',
  español: 'es',
  es: 'es',
}

const STATUS_WORDS: Record<string, LeadStatus> = {
  new: 'new',
  working: 'working',
  active: 'working',
  open: 'working',
  'follow up': 'follow_up_scheduled',
  'follow-up': 'follow_up_scheduled',
  'follow up scheduled': 'follow_up_scheduled',
  waiting: 'waiting_on_customer',
  'waiting on customer': 'waiting_on_customer',
  appointment: 'appointment_scheduled',
  'appointment set': 'appointment_scheduled',
  'appt set': 'appointment_scheduled',
  sold: 'sold',
  lost: 'lost',
  dead: 'lost',
  'do not contact': 'do_not_contact',
  dnc: 'do_not_contact',
  archived: 'archived',
}

/** Activity phrases a CRM timeline prints, mapped to our vocabulary. */
const ACTIVITY_WORDS: Array<{ pattern: RegExp; type: ActivityType; direction: 'outbound' | 'inbound' }> =
  [
    { pattern: /\boutbound call\b|\bcalled\b|\bcall placed\b/i, type: 'outbound_call', direction: 'outbound' },
    { pattern: /\binbound call\b|\bcall received\b|\bcustomer called\b/i, type: 'inbound_call', direction: 'inbound' },
    { pattern: /\boutbound (text|sms)\b|\btext sent\b|\bsms sent\b/i, type: 'outbound_text', direction: 'outbound' },
    { pattern: /\binbound (text|sms)\b|\btext received\b|\bcustomer texted\b/i, type: 'inbound_text', direction: 'inbound' },
    { pattern: /\boutbound email\b|\bemail sent\b|\bemailed\b/i, type: 'outbound_email', direction: 'outbound' },
    { pattern: /\binbound email\b|\bemail received\b|\bcustomer emailed\b/i, type: 'inbound_email', direction: 'inbound' },
    { pattern: /\bvoicemail left\b|\bleft voicemail\b|\blvm\b/i, type: 'voicemail_left', direction: 'outbound' },
    { pattern: /\bvoicemail received\b/i, type: 'voicemail_received', direction: 'inbound' },
  ]

export interface ParseOptions {
  /** Anchors relative dates such as "yesterday" seen in a CRM timeline. */
  now?: Date
}

/**
 * Parses OCR text. Always returns a validation result rather than throwing, so
 * unreadable output becomes EXTRACTION_FAILED instead of a crash.
 */
export function parseOcrText(rawText: string, options: ParseOptions = {}): ExtractionValidation {
  const safe = sanitizeUntrustedText(rawText)
  const text = readUntrusted(safe)

  if (text.trim().length < 8) {
    return validateExtraction({
      ...emptyExtraction(),
      warnings: ['ocr_text_too_short'],
    })
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

  const result = emptyExtraction()
  const warnings: string[] = []
  const fieldConfidences: number[] = []

  const record = (value: string | null, confidence: number): string | null => {
    if (value !== null) fieldConfidences.push(confidence)
    return value
  }

  // --- customer -----------------------------------------------------------
  result.customer.fullName = record(findLabelled(lines, LABELS.fullName), 0.9)
  result.customer.firstName = record(findLabelled(lines, LABELS.firstName), 0.85)
  result.customer.lastName = record(findLabelled(lines, LABELS.lastName), 0.85)
  result.customer.customerId = record(findLabelled(lines, LABELS.customerId), 0.95)
  result.salesperson = record(findLabelled(lines, LABELS.salesperson), 0.7)
  result.leadSource = record(findLabelled(lines, LABELS.leadSource), 0.7)

  // A labelled phone is trusted more than one found loose in the text.
  const labelledPhone = findLabelled(lines, LABELS.phone)
  const phoneSource = labelledPhone ?? firstMatch(text, PHONE_PATTERN)
  const phone = phoneSource === null ? null : (PHONE_PATTERN.exec(phoneSource)?.[0] ?? null)
  result.customer.phone = record(phone, labelledPhone === null ? 0.7 : 0.9)

  const labelledEmail = findLabelled(lines, LABELS.email)
  const email = firstMatch(labelledEmail ?? text, EMAIL_PATTERN)
  result.customer.email = record(email, labelledEmail === null ? 0.75 : 0.92)

  const city = findLabelled(lines, LABELS.city)
  const state = findLabelled(lines, LABELS.state)
  if (city !== null) result.customer.city = record(city, 0.8)
  if (state !== null && /^[A-Za-z]{2}$/.test(state)) result.customer.state = record(state.toUpperCase(), 0.8)

  // "Sweetwater, TX" on one line is the common CRM layout.
  if (result.customer.city === null || result.customer.state === null) {
    for (const line of lines) {
      const match = CITY_STATE_PATTERN.exec(stripLabel(line))
      if (match === null) continue
      result.customer.city ??= record(match[1]?.trim() ?? null, 0.75)
      result.customer.state ??= record(match[2]?.toUpperCase() ?? null, 0.75)
      break
    }
  }

  const language = findLabelled(lines, LABELS.language)
  if (language !== null) {
    result.customer.preferredLanguage = LANGUAGE_WORDS[language.toLowerCase()] ?? null
    if (result.customer.preferredLanguage !== null) fieldConfidences.push(0.8)
  }

  const status = findLabelled(lines, LABELS.status)
  if (status !== null) {
    result.leadStatus = STATUS_WORDS[status.toLowerCase().trim()] ?? null
    if (result.leadStatus !== null) fieldConfidences.push(0.75)
  }

  // If no name was labelled, fall back to a line that looks like a person's
  // name — but flag it, because that guess is exactly what should not be
  // trusted enough for an automatic write.
  if (result.customer.fullName === null) {
    const guessed = guessNameLine(lines)
    if (guessed !== null) {
      result.customer.fullName = guessed
      fieldConfidences.push(0.45)
      warnings.push('name_inferred_without_label')
    } else {
      warnings.push('no_customer_name_found')
    }
  }

  if (result.customer.fullName !== null && result.customer.firstName === null) {
    const split = splitFullName(result.customer.fullName)
    result.customer.firstName = split.firstName
    result.customer.lastName ??= split.lastName
  }

  // --- vehicle ------------------------------------------------------------
  const year = findLabelled(lines, LABELS.year) ?? firstMatch(text, /\b(19[5-9]\d|20[0-9]\d)\b/)
  const parsedYear = year === null ? Number.NaN : Number.parseInt(year, 10)
  if (Number.isInteger(parsedYear) && parsedYear >= 1950 && parsedYear <= 2100) {
    result.vehicleInterest.year = parsedYear
    fieldConfidences.push(0.7)
  }

  result.vehicleInterest.make = record(findLabelled(lines, LABELS.make), 0.75)
  result.vehicleInterest.model = record(findLabelled(lines, LABELS.model), 0.75)
  result.vehicleInterest.floorplan = record(findLabelled(lines, LABELS.floorplan), 0.7)
  result.vehicleInterest.stockNumber = record(findLabelled(lines, LABELS.stockNumber), 0.85)

  const condition = (findLabelled(lines, LABELS.condition) ?? '').toLowerCase()
  if (condition.includes('new')) result.vehicleInterest.newOrUsed = 'new'
  else if (condition.includes('used') || condition.includes('pre-owned')) {
    result.vehicleInterest.newOrUsed = 'used'
  }

  // --- contact availability ----------------------------------------------
  result.availableContactMethods = deriveContactMethods(result, text)

  // --- visible activity ---------------------------------------------------
  result.visibleActivities = deriveActivities(lines, options.now ?? new Date())

  // --- multiple customers -------------------------------------------------
  const nameLabelCount = countLabelOccurrences(lines, LABELS.fullName)
  const distinctPhones = new Set(
    [...text.matchAll(new RegExp(PHONE_PATTERN, 'g'))]
      .map((match) => normalizePhone(match[0]))
      .filter((value): value is string => value !== null),
  )

  if (nameLabelCount > 1 || distinctPhones.size > 1) {
    result.containsMultipleCustomers = true
    warnings.push('multiple_customers_detected')
  }

  result.warnings = warnings
  result.overallConfidence = computeOverallConfidence(fieldConfidences, result)

  return validateExtraction(result)
}

/**
 * Availability, not attempts. A channel appears here because the screenshot
 * shows the customer *has* it, never because something was sent to it.
 */
function deriveContactMethods(result: ExtractionResult, text: string): ExtractedContactMethod[] {
  const methods: ExtractedContactMethod[] = []
  const lower = text.toLowerCase()

  if (result.customer.phone !== null) {
    methods.push({ method: 'phone_call', available: true, value: result.customer.phone, confidence: 0.9 })
    // A mobile number implies texting is possible; a landline label does not.
    const mobile = /\b(mobile|cell|sms|text)\b/.test(lower)
    methods.push({
      method: 'sms',
      available: true,
      value: result.customer.phone,
      confidence: mobile ? 0.85 : 0.6,
    })
  }

  if (result.customer.email !== null) {
    methods.push({ method: 'email', available: true, value: result.customer.email, confidence: 0.9 })
  }

  if (/\bwhatsapp\b/.test(lower)) {
    methods.push({
      method: 'whatsapp',
      available: true,
      value: result.customer.phone,
      confidence: 0.65,
    })
  }

  return methods
}

/**
 * Activity the CRM shows, with `performedByCurrentUser` left null.
 *
 * The screenshot says something happened; it does not say I did it. Recording
 * null here is what keeps an automated brochure email out of my attempt count.
 */
function deriveActivities(lines: readonly string[], now: Date): ExtractedActivity[] {
  const activities: ExtractedActivity[] = []

  for (const line of lines) {
    for (const { pattern, type, direction } of ACTIVITY_WORDS) {
      if (!pattern.test(line)) continue

      activities.push({
        type,
        direction,
        performedByCurrentUser: null,
        occurredAt: parseTimelineDate(line, now),
        summary: line.slice(0, 500),
        confidence: 0.6,
      })
      break
    }

    if (activities.length >= 50) break
  }

  return activities
}

/** Recognises the handful of date shapes a CRM timeline actually prints. */
function parseTimelineDate(line: string, now: Date): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(line)
  if (iso !== null) {
    const parsed = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00.000Z`)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }

  const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(line)
  if (slash !== null) {
    const year = Number.parseInt(slash[3] ?? '', 10)
    const fullYear = year < 100 ? 2000 + year : year
    const month = Number.parseInt(slash[1] ?? '', 10)
    const day = Number.parseInt(slash[2] ?? '', 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(fullYear, month - 1, day, 12)).toISOString()
    }
  }

  const relative = /\b(\d{1,3})\s+(hour|day|week)s?\s+ago\b/i.exec(line)
  if (relative !== null) {
    const amount = Number.parseInt(relative[1] ?? '0', 10)
    const unit = (relative[2] ?? '').toLowerCase()
    const ms = unit === 'hour' ? 3_600_000 : unit === 'day' ? 86_400_000 : 604_800_000
    return new Date(now.getTime() - amount * ms).toISOString()
  }

  if (/\byesterday\b/i.test(line)) return new Date(now.getTime() - 86_400_000).toISOString()
  if (/\btoday\b/i.test(line)) return now.toISOString()

  return null
}

/**
 * Overall confidence, weighted towards the fields that establish identity.
 *
 * A screenshot with a crisp customer ID and nothing else is far more useful
 * than one with a blurry name and six vehicle details, and the score has to say
 * so — the decision engine reads it to decide whether to write automatically.
 */
function computeOverallConfidence(
  fieldConfidences: readonly number[],
  result: ExtractionResult,
): number {
  if (fieldConfidences.length === 0) return 0

  const average = fieldConfidences.reduce((total, value) => total + value, 0) / fieldConfidences.length

  let score = average
  if (result.customer.customerId !== null) score = Math.min(1, score + 0.1)
  if (result.customer.phone !== null || result.customer.email !== null) score = Math.min(1, score + 0.05)
  if (result.customer.fullName === null) score = Math.min(score, 0.3)
  if (result.containsMultipleCustomers) score = Math.min(score, 0.5)

  return Number(score.toFixed(3))
}

// ---------------------------------------------------------------------------
// Line helpers
// ---------------------------------------------------------------------------

/** Finds the value after a `Label:` prefix, matching the longest label first. */
function findLabelled(lines: readonly string[], labels: readonly string[]): string | null {
  const ordered = [...labels].sort((a, b) => b.length - a.length)

  for (const line of lines) {
    const separator = line.indexOf(':')
    if (separator === -1) continue

    const label = line.slice(0, separator).trim().toLowerCase().replace(/\s+/g, ' ')
    const value = line.slice(separator + 1).trim()
    if (value === '') continue

    if (ordered.some((candidate) => label === candidate)) return value
  }

  return null
}

function countLabelOccurrences(lines: readonly string[], labels: readonly string[]): number {
  let count = 0

  for (const line of lines) {
    const separator = line.indexOf(':')
    if (separator === -1) continue

    const label = line.slice(0, separator).trim().toLowerCase().replace(/\s+/g, ' ')
    if (labels.some((candidate) => label === candidate) && line.slice(separator + 1).trim() !== '') {
      count += 1
    }
  }

  return count
}

function stripLabel(line: string): string {
  const separator = line.indexOf(':')
  return separator === -1 ? line : line.slice(separator + 1).trim()
}

function firstMatch(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[0] ?? null
}

/**
 * Last resort when nothing is labelled: a line of two or three capitalised
 * words that is not obviously a field value. Always flagged as inferred.
 */
function guessNameLine(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (line.includes(':')) continue
    if (EMAIL_PATTERN.test(line) || PHONE_PATTERN.test(line)) continue

    const words = line.split(/\s+/)
    if (words.length < 2 || words.length > 4) continue
    if (!words.every((word) => /^[A-Z][a-zà-ÿA-Z'’.-]*$/.test(word))) continue

    return line
  }

  return null
}

/** Convenience for callers that already hold sanitised text. */
export function parseUntrustedOcr(text: UntrustedText, options: ParseOptions = {}): ExtractionValidation {
  return parseOcrText(readUntrusted(text), options)
}
