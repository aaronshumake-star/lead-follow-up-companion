/**
 * In-browser OCR with Tesseract.js.
 *
 * Free, open source, and runs entirely on the device — the image never reaches
 * a server, which is both a privacy property and the reason screenshot
 * extraction costs nothing per capture. The engine and its language data are
 * imported lazily so the ~10 MB download only happens the first time somebody
 * actually pastes a screenshot, rather than on every page load.
 */

import type { ProviderInfo, ProviderResult } from '../types.ts'
import { providerFailure, providerOk } from '../types.ts'
import { sanitizeUntrustedText } from '../../lib/untrusted.ts'
import { parseOcrText } from '../../domain/screenshot/parse-ocr.ts'
import type {
  ExtractedField,
  ScreenshotExtractionInput,
  ScreenshotExtractionProvider,
  ScreenshotExtractionResult,
} from './types.ts'
import type { ExtractionResult } from '../../domain/screenshot/extraction.ts'

export interface TesseractProviderOptions {
  onProgress?: (progress: number) => void
  /** Aborts a long-running job when the operator cancels. */
  signal?: AbortSignal
}

export function createTesseractExtractionProvider(
  options: TesseractProviderOptions = {},
): ScreenshotExtractionProvider {
  return {
    info: {
      id: 'tesseract',
      displayName: 'Tesseract.js (in-browser)',
      isConfigured: true,
      // On-device, so no per-image charge exists.
      isBillable: false,
    } satisfies ProviderInfo,

    async extract(input: ScreenshotExtractionInput): Promise<ProviderResult<ScreenshotExtractionResult>> {
      const started = Date.now()

      try {
        // Lazy: keeps the engine and language data out of the initial bundle.
        const { recognize } = await import('tesseract.js')

        if (options.signal?.aborted === true) {
          return providerFailure<ScreenshotExtractionResult>('timeout', 'Extraction was cancelled.')
        }

        const language = input.languageHint === 'spa' ? 'spa' : 'eng'

        const result = await recognize(input.image, language, {
          logger: (message: { status: string; progress: number }) => {
            if (message.status === 'recognizing text') options.onProgress?.(message.progress)
          },
        })

        // Checked again after recognition: a cancel during a long job should
        // discard the result rather than apply it.
        if (options.signal !== undefined && options.signal.aborted) {
          return providerFailure<ScreenshotExtractionResult>('timeout', 'Extraction was cancelled.')
        }

        const text = result.data.text ?? ''
        const rawText = sanitizeUntrustedText(text)
        const parsed = parseOcrText(text)

        return providerOk<ScreenshotExtractionResult>({
          providerId: 'tesseract',
          rawText,
          fields: parsed.ok ? fieldsFrom(parsed.value) : [],
          durationMs: Date.now() - started,
        })
      } catch (cause) {
        // A failed OCR run is an ordinary outcome of pointing a camera at a
        // spreadsheet, so it degrades into a result rather than an exception.
        return providerFailure<ScreenshotExtractionResult>(
          'provider_error',
          cause instanceof Error && cause.message !== ''
            ? 'The OCR engine could not read that image.'
            : 'The OCR engine failed to start.',
          true,
        )
      }
    },
  }
}

function fieldsFrom(value: ExtractionResult): ExtractedField[] {
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
