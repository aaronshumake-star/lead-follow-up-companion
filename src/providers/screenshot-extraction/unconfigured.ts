import type { ProviderInfo, ProviderResult } from '../types.ts'
import { notConfigured } from '../types.ts'
import type {
  ScreenshotExtractionInput,
  ScreenshotExtractionProvider,
  ScreenshotExtractionResult,
} from './types.ts'

/**
 * Phase 1 placeholder. Accepts and hashes nothing, spends nothing, and reports
 * clearly that extraction is not wired up yet.
 *
 * The Tesseract.js implementation replaces this in a later phase; the Screenshot
 * Inbox already handles the failure result, so swapping it in is a one-line
 * change in the registry.
 */
export const unconfiguredScreenshotExtractionProvider: ScreenshotExtractionProvider = {
  info: {
    id: 'unconfigured',
    displayName: 'Not configured',
    isConfigured: false,
    isBillable: false,
  } satisfies ProviderInfo,

  async extract(_input: ScreenshotExtractionInput): Promise<ProviderResult<ScreenshotExtractionResult>> {
    return notConfigured<ScreenshotExtractionResult>('Screenshot extraction')
  },
}
