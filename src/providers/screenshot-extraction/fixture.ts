/**
 * Deterministic OCR provider for demo mode and automated tests.
 *
 * Returns fixture text chosen by the image hash, so the same paste always
 * produces the same extraction and a test can assert an exact decision. No
 * network, no worker, no cost — which is what makes the whole screenshot
 * workflow exercisable in CI and on a fresh clone.
 *
 * The scenarios are deliberately chosen to cover every branch of the decision
 * engine, including the ones that must never be automatic.
 */

import type { ProviderInfo, ProviderResult } from '../types.ts'
import { providerOk } from '../types.ts'
import { sanitizeUntrustedText } from '../../lib/untrusted.ts'
import type {
  ScreenshotExtractionInput,
  ScreenshotExtractionProvider,
  ScreenshotExtractionResult,
} from './types.ts'
import { parseOcrText } from '../../domain/screenshot/parse-ocr.ts'
import type { ExtractedField } from './types.ts'

export interface FixtureScenario {
  id: string
  label: string
  description: string
  text: string
}

/**
 * The demo scenarios, in the order the Screenshot Inbox offers them. Each maps
 * onto a decision the engine must reach.
 */
export const FIXTURE_SCENARIOS: FixtureScenario[] = [
  {
    id: 'new_customer',
    label: 'New customer',
    description: 'A lead not yet on file — expects AUTO_CREATE.',
    text: [
      'Customer: Wanda Petrossian',
      'ID: RV-100310',
      'Phone: (555) 010-0310',
      'Email: wanda.petrossian@example.com',
      'City: Midland, TX',
      'Source: Website form',
      'Status: New',
      'Year: 2026',
      'Make: Cedar Ridge',
      'Model: Reflection',
      'Floorplan: 31MB',
      'Stock: STK-49110',
      'Condition: New',
      'Mobile number on file',
    ].join('\n'),
  },
  {
    id: 'existing_customer',
    label: 'Existing customer',
    description: 'Matches Jesus Ayala on dealership ID — expects AUTO_UPDATE.',
    text: [
      'Customer: Jesus Ayala',
      'ID: RV-100114',
      'Phone: (555) 010-0114',
      'City: Abilene, TX',
      'Status: Working',
      'Year: 2026',
      'Make: Cedar Ridge',
      'Model: Reflection',
      'Stock: STK-49001',
      'Outbound text 2 days ago',
    ].join('\n'),
  },
  {
    id: 'conflicting_phone',
    label: 'Conflicting phone',
    description: 'Same dealership ID, different phone — expects NEEDS_CONFLICT_REVIEW.',
    text: [
      'Customer: Jesus Ayala',
      'ID: RV-100114',
      'Phone: (555) 010-7777',
      'Email: jesus.ayala@example.com',
      'City: Abilene, TX',
    ].join('\n'),
  },
  {
    id: 'name_only',
    label: 'Name matches only',
    description: 'A same-named person with no shared identifier — expects NEEDS_MATCH_REVIEW.',
    text: ['Customer: Jesus Ayala', 'City: Odessa, TX', 'Source: RV show'].join('\n'),
  },
  {
    id: 'multiple_customers',
    label: 'Two customers visible',
    description: 'A CRM list view — expects NEEDS_CONFLICT_REVIEW.',
    text: [
      'Customer: Blanca Alcocer',
      'Phone: (555) 010-0410',
      'Customer: Daniel Rountree',
      'Phone: (555) 010-0411',
    ].join('\n'),
  },
  {
    id: 'unreadable',
    label: 'Unreadable capture',
    description: 'Noise with no identity — expects EXTRACTION_FAILED.',
    text: '### ~~~ ??? ###',
  },
]

const DEFAULT_SCENARIO = FIXTURE_SCENARIOS[0] as FixtureScenario

/**
 * Chooses a scenario from the image hash so the same bytes always extract the
 * same way. A caller can also force one by name, which is what the demo
 * scenario picker and the Playwright tests use.
 */
export function scenarioForHash(fileHash: string, forced?: string | null): FixtureScenario {
  if (typeof forced === 'string') {
    const match = FIXTURE_SCENARIOS.find((scenario) => scenario.id === forced)
    if (match !== undefined) return match
  }

  const nibble = Number.parseInt(fileHash.slice(0, 2), 16)
  if (Number.isNaN(nibble)) return DEFAULT_SCENARIO

  return FIXTURE_SCENARIOS[nibble % FIXTURE_SCENARIOS.length] ?? DEFAULT_SCENARIO
}

export interface FixtureProviderOptions {
  /** Forces one scenario regardless of the hash. */
  scenarioId?: string | null
  /** Simulated work, so the progress UI is exercisable. */
  delayMs?: number
  onProgress?: (progress: number) => void
}

export function createFixtureExtractionProvider(
  options: FixtureProviderOptions = {},
): ScreenshotExtractionProvider {
  return {
    info: {
      id: 'fixture',
      displayName: 'Simulated OCR (demo)',
      isConfigured: true,
      // Nothing leaves the browser, so there is nothing to bill.
      isBillable: false,
    } satisfies ProviderInfo,

    async extract(input: ScreenshotExtractionInput): Promise<ProviderResult<ScreenshotExtractionResult>> {
      const started = Date.now()
      const scenario = scenarioForHash(input.fileHash, options.scenarioId)

      for (const step of [0.25, 0.6, 0.9, 1]) {
        options.onProgress?.(step)
        if ((options.delayMs ?? 0) > 0) {
          await new Promise((resolve) => setTimeout(resolve, (options.delayMs ?? 0) / 4))
        }
      }

      const rawText = sanitizeUntrustedText(scenario.text)
      const parsed = parseOcrText(scenario.text)

      return providerOk<ScreenshotExtractionResult>({
        providerId: 'fixture',
        rawText,
        fields: parsed.ok ? fieldsFrom(parsed.value) : [],
        durationMs: Date.now() - started,
      })
    },
  }
}

/** Flattens a parsed extraction into the provider's reviewable field list. */
function fieldsFrom(value: import('../../domain/screenshot/extraction.ts').ExtractionResult): ExtractedField[] {
  const fields: ExtractedField[] = []

  const push = (key: ExtractedField['key'], text: string | null, confidence: number) => {
    if (text === null) return
    fields.push({ key, value: sanitizeUntrustedText(text), confidence })
  }

  push('full_name', value.customer.fullName, 0.9)
  push('primary_phone', value.customer.phone, 0.85)
  push('primary_email', value.customer.email, 0.85)
  push('dealership_customer_id', value.customer.customerId, 0.95)
  push('city', value.customer.city, 0.8)
  push('state', value.customer.state, 0.8)
  push('lead_source', value.leadSource, 0.7)
  push('vehicle_make', value.vehicleInterest.make, 0.75)
  push('vehicle_model', value.vehicleInterest.model, 0.75)
  push('vehicle_floorplan', value.vehicleInterest.floorplan, 0.7)
  push('vehicle_stock_number', value.vehicleInterest.stockNumber, 0.85)

  return fields
}
