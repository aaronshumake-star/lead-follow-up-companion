import type { ProviderInfo, ProviderResult } from '../types.ts'
import { providerOk } from '../types.ts'
import type { CommandParsingInput, CommandParsingProvider, ParsedCommand } from './types.ts'
import { parseCommand } from '../../domain/messaging/command-parser.ts'
import { readUntrusted } from '../../lib/untrusted.ts'
import { DEFAULT_SETTINGS } from '../../domain/settings.ts'

/**
 * The rule-based command parser, exposed through the Phase 1 provider
 * interface.
 *
 * Free, instant, offline and fully testable, which is why it is the default. An
 * AI parser could be slotted in behind the same interface later, but it would
 * cost money per message and must stay disabled by default.
 */
export const deterministicCommandParsingProvider: CommandParsingProvider = {
  info: {
    id: 'deterministic',
    displayName: 'Rule-based parser',
    isConfigured: true,
    // Runs locally; there is nothing to bill.
    isBillable: false,
  } satisfies ProviderInfo,

  async parse(input: CommandParsingInput): Promise<ProviderResult<ParsedCommand>> {
    const parsed = parseCommand(readUntrusted(input.text), {
      settings: { ...DEFAULT_SETTINGS, timeZone: input.timeZone },
      now: input.now,
    })

    return providerOk<ParsedCommand>({
      // The two vocabularies overlap; anything the Phase 1 union does not name
      // is reported as unknown rather than being coerced into a near match.
      intent: mapIntent(parsed.intent),
      confidence: parsed.confidence,
      customer:
        parsed.customerReference === null
          ? undefined
          : {
              spokenName: parsed.customerReference.spokenName,
              phone: parsed.customerReference.phoneLastFour,
              dealershipCustomerId: parsed.customerReference.dealershipCustomerId,
            },
      activity:
        parsed.activity === undefined
          ? undefined
          : {
              type: parsed.activity.type,
              method: parsed.activity.method ?? undefined,
              outcome: parsed.activity.outcome ?? undefined,
              summary: parsed.summary,
            },
      followUp:
        parsed.followUp === undefined ? undefined : { dueAt: parsed.followUp.dueAt, reason: parsed.summary },
      statusChange: parsed.statusChange === undefined ? undefined : { leadStatus: parsed.statusChange },
      confirmationHint: parsed.summary,
    })
  },
}

const INTENT_MAP: Record<string, ParsedCommand['intent']> = {
  log_activity: 'log_activity',
  schedule_follow_up: 'schedule_follow_up',
  log_activity_and_schedule: 'log_activity_and_schedule',
  snooze_follow_up: 'snooze_follow_up',
  complete_follow_up: 'complete_follow_up',
  set_status: 'set_status',
  lookup_customer: 'lookup_customer',
  list_due_today: 'list_due_today',
  list_overdue: 'list_overdue',
  list_no_next_action: 'list_no_next_action',
  help: 'help',
}

function mapIntent(intent: string): ParsedCommand['intent'] {
  return INTENT_MAP[intent] ?? 'unknown'
}
