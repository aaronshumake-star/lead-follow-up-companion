import type { ProviderInfo, ProviderResult } from '../types.ts'
import { providerOk } from '../types.ts'
import type { CommandParsingInput, CommandParsingProvider, ParsedCommand } from './types.ts'

/**
 * Phase 1 placeholder.
 *
 * It succeeds rather than erroring, returning the `unknown` intent at zero
 * confidence. That is the correct degraded behaviour: a command the app cannot
 * understand should produce a clarifying reply, not an error path — and since
 * confidence is below MIN_AUTO_APPLY_CONFIDENCE, nothing can be applied from it.
 */
export const unconfiguredCommandParsingProvider: CommandParsingProvider = {
  info: {
    id: 'unconfigured',
    displayName: 'Not configured',
    isConfigured: false,
    isBillable: false,
  } satisfies ProviderInfo,

  async parse(_input: CommandParsingInput): Promise<ProviderResult<ParsedCommand>> {
    return providerOk<ParsedCommand>({
      intent: 'unknown',
      confidence: 0,
      confirmationHint: 'Command parsing is not configured yet. Use the dashboard for now.',
    })
  },
}
