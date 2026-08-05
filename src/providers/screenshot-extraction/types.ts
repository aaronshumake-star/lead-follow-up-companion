/**
 * Screenshot extraction: turning a pasted CRM capture into candidate field
 * values.
 *
 * The interface is deliberately review-oriented. Extraction never writes a
 * customer directly; it produces candidates with confidence scores that the
 * Screenshot Inbox asks me to confirm. That keeps OCR text firmly in the
 * category of untrusted data.
 *
 * Phase 1 defines the contract only. The default implementation is Tesseract.js
 * running in the browser, which is free and keeps images off any server.
 */

import type { ProviderInfo, ProviderResult } from '../types.ts'
import type { UntrustedText } from '../../lib/untrusted.ts'

/** Field keys the extractor may emit; they map onto customer columns. */
export const EXTRACTABLE_FIELD_KEYS = [
  'full_name',
  'first_name',
  'last_name',
  'primary_phone',
  'primary_email',
  'dealership_customer_id',
  'city',
  'state',
  'preferred_language',
  'salesperson',
  'lead_source',
  'lead_status',
  'lead_temperature',
  'vehicle_year',
  'vehicle_make',
  'vehicle_model',
  'vehicle_floorplan',
  'vehicle_stock_number',
  'notes',
] as const
export type ExtractableFieldKey = (typeof EXTRACTABLE_FIELD_KEYS)[number]

export interface ExtractedField {
  key: ExtractableFieldKey
  /** Untrusted: it came out of an image the app cannot vouch for. */
  value: UntrustedText
  /** 0–1. Low-confidence fields are surfaced for review rather than applied. */
  confidence: number
  boundingBox?: { x: number; y: number; width: number; height: number }
}

export interface ScreenshotExtractionInput {
  image: Blob
  /** sha256 of the bytes, used to skip re-extracting a duplicate paste. */
  fileHash: string
  /** Locale hint; the CRM is bilingual in practice. */
  languageHint?: 'eng' | 'spa'
}

export interface ScreenshotExtractionResult {
  providerId: string
  /** Full untrusted text, kept so a missed field can be recovered by hand. */
  rawText: UntrustedText
  fields: ExtractedField[]
  durationMs: number
}

export interface ScreenshotExtractionProvider {
  readonly info: ProviderInfo
  extract(input: ScreenshotExtractionInput): Promise<ProviderResult<ScreenshotExtractionResult>>
}
