/**
 * The single place that decides which implementation backs each capability.
 *
 * Feature code imports from here and never from a concrete provider, so
 * swapping the WhatsApp transport or the OCR engine is a change to this file
 * alone. Phase 1 wires every slot to a placeholder that fails closed.
 */

import type { ScreenshotExtractionProvider } from './screenshot-extraction/types.ts'
import { createFixtureExtractionProvider } from './screenshot-extraction/fixture.ts'
import { createTesseractExtractionProvider } from './screenshot-extraction/tesseract.ts'
import type { WhatsAppProvider } from './whatsapp/types.ts'
import { unconfiguredWhatsAppProvider } from './whatsapp/unconfigured.ts'
import { createSimulatedWhatsAppProvider } from './whatsapp/simulated.ts'
import { isDemoMode } from '../config/env.ts'
import { DEMO_APPROVED_NUMBER } from '../data/demo/import-runtime.ts'
import type { VoiceTranscriptionProvider } from './voice-transcription/types.ts'
import { disabledVoiceTranscriptionProvider } from './voice-transcription/disabled.ts'
import type { CommandParsingProvider } from './command-parsing/types.ts'
import { deterministicCommandParsingProvider } from './command-parsing/deterministic.ts'
import type { ProviderInfo } from './types.ts'

export interface ProviderRegistry {
  screenshotExtraction: ScreenshotExtractionProvider
  whatsapp: WhatsAppProvider
  voiceTranscription: VoiceTranscriptionProvider
  commandParsing: CommandParsingProvider
}

/**
 * The active providers.
 *
 * Screenshot extraction and command parsing are configured from Phase 3
 * onwards: OCR runs on the device through Tesseract.js (or a deterministic
 * fixture in demo mode) and commands are parsed by a rule-based parser. Both
 * are free, which is why `isBillable` stays false.
 *
 * WhatsApp is deliberately reported through the placeholder here. The real
 * Cloud API client is server-only and lives in the Worker, so the browser has
 * no credentials and genuinely cannot send — which is what this page should
 * say. Demo mode substitutes the simulated transport.
 *
 * Voice transcription stays disabled until Phase 4.
 */
export const defaultProviderRegistry: ProviderRegistry = {
  screenshotExtraction: isDemoMode
    ? createFixtureExtractionProvider()
    : createTesseractExtractionProvider(),
  whatsapp: isDemoMode
    ? createSimulatedWhatsAppProvider(DEMO_APPROVED_NUMBER)
    : unconfiguredWhatsAppProvider,
  voiceTranscription: disabledVoiceTranscriptionProvider,
  commandParsing: deterministicCommandParsingProvider,
}

export type ProviderSlot = keyof ProviderRegistry

export const PROVIDER_SLOT_LABELS: Record<ProviderSlot, string> = {
  screenshotExtraction: 'Screenshot extraction',
  whatsapp: 'WhatsApp messaging',
  voiceTranscription: 'Voice transcription',
  commandParsing: 'Command parsing',
}

/** Feeds the Settings page so provider status is visible without reading code. */
export function describeProviders(
  registry: ProviderRegistry = defaultProviderRegistry,
): Array<{ slot: ProviderSlot; label: string; info: ProviderInfo }> {
  return (Object.keys(PROVIDER_SLOT_LABELS) as ProviderSlot[]).map((slot) => ({
    slot,
    label: PROVIDER_SLOT_LABELS[slot],
    info: registry[slot].info,
  }))
}
