/**
 * The single place that decides which implementation backs each capability.
 *
 * Feature code imports from here and never from a concrete provider, so
 * swapping the WhatsApp transport or the OCR engine is a change to this file
 * alone. Phase 1 wires every slot to a placeholder that fails closed.
 */

import type { ScreenshotExtractionProvider } from './screenshot-extraction/types.ts'
import { unconfiguredScreenshotExtractionProvider } from './screenshot-extraction/unconfigured.ts'
import type { WhatsAppProvider } from './whatsapp/types.ts'
import { unconfiguredWhatsAppProvider } from './whatsapp/unconfigured.ts'
import type { VoiceTranscriptionProvider } from './voice-transcription/types.ts'
import { disabledVoiceTranscriptionProvider } from './voice-transcription/disabled.ts'
import type { CommandParsingProvider } from './command-parsing/types.ts'
import { unconfiguredCommandParsingProvider } from './command-parsing/unconfigured.ts'
import type { ProviderInfo } from './types.ts'

export interface ProviderRegistry {
  screenshotExtraction: ScreenshotExtractionProvider
  whatsapp: WhatsAppProvider
  voiceTranscription: VoiceTranscriptionProvider
  commandParsing: CommandParsingProvider
}

export const defaultProviderRegistry: ProviderRegistry = {
  screenshotExtraction: unconfiguredScreenshotExtractionProvider,
  whatsapp: unconfiguredWhatsAppProvider,
  voiceTranscription: disabledVoiceTranscriptionProvider,
  commandParsing: unconfiguredCommandParsingProvider,
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
