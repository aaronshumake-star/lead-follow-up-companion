/**
 * The cost meter.
 *
 * Measured from recorded usage rather than estimated from settings, so the
 * projection reflects what the app actually did. The point is to notice a
 * drift towards the annual threshold early, while there is still a cheap lever
 * to pull — digest-only mode, a longer overdue interval, or turning individual
 * reminders off.
 */

import type { UsageEvent, UsageEventKind } from '../models.ts'

export interface UsageTotals {
  ocrJobs: number
  messagesSent: number
  messagesReceived: number
  messagesFailed: number
  messageRetries: number
  remindersGenerated: number
  screenshotsRetained: number
  costUsd: number
  voiceMessages: number
  audioMinutes: number
  transcriptionRequests: number
  transcriptionFailures: number
  transcriptionRetries: number
  retainedAudio: number
}

export interface CostProjection {
  /** Totals across the window that was measured. */
  totals: UsageTotals
  /** Days of data the projection is based on. */
  observedDays: number
  projectedAnnualUsd: number
  thresholdUsd: number
  /** True once the projection reaches 80% of the threshold. */
  approachingThreshold: boolean
  overThreshold: boolean
}

const EMPTY: UsageTotals = {
  ocrJobs: 0,
  messagesSent: 0,
  messagesReceived: 0,
  messagesFailed: 0,
  messageRetries: 0,
  remindersGenerated: 0,
  screenshotsRetained: 0,
  costUsd: 0,
  voiceMessages: 0,
  audioMinutes: 0,
  transcriptionRequests: 0,
  transcriptionFailures: 0,
  transcriptionRetries: 0,
  retainedAudio: 0,
}

const FIELD_BY_KIND: Record<UsageEventKind, keyof UsageTotals> = {
  ocr_job: 'ocrJobs',
  screenshot_retained: 'screenshotsRetained',
  message_sent: 'messagesSent',
  message_received: 'messagesReceived',
  message_failed: 'messagesFailed',
  message_retry: 'messageRetries',
  reminder_generated: 'remindersGenerated',
  voice_message_received: 'voiceMessages',
  audio_minute_processed: 'audioMinutes',
  transcription_request: 'transcriptionRequests',
  transcription_failed: 'transcriptionFailures',
  transcription_retry: 'transcriptionRetries',
  audio_retained: 'retainedAudio',
}

export function summarizeUsage(events: readonly UsageEvent[]): UsageTotals {
  const totals: UsageTotals = { ...EMPTY }

  for (const event of events) {
    const field = FIELD_BY_KIND[event.kind]
    totals[field] += event.quantity
    totals.costUsd += event.estimatedCostUsd
  }

  return { ...totals, costUsd: Number(totals.costUsd.toFixed(4)) }
}

/**
 * Projects an annual cost from measured usage.
 *
 * A short observation window is extrapolated conservatively — anything under a
 * week is treated as a week, because three expensive days should not project a
 * catastrophe on the strength of three data points.
 */
export function projectAnnualCost(
  events: readonly UsageEvent[],
  thresholdUsd: number,
  now: Date = new Date(),
): CostProjection {
  const totals = summarizeUsage(events)

  const earliest = events.reduce<number | null>((oldest, event) => {
    const time = new Date(event.occurredAt).getTime()
    return oldest === null || time < oldest ? time : oldest
  }, null)

  const rawDays = earliest === null ? 0 : (now.getTime() - earliest) / 86_400_000
  const observedDays = Math.max(7, Math.ceil(rawDays))

  const projectedAnnualUsd =
    totals.costUsd === 0 ? 0 : Number(((totals.costUsd / observedDays) * 365).toFixed(2))

  return {
    totals,
    observedDays,
    projectedAnnualUsd,
    thresholdUsd,
    approachingThreshold: thresholdUsd > 0 && projectedAnnualUsd >= thresholdUsd * 0.8,
    overThreshold: thresholdUsd > 0 && projectedAnnualUsd > thresholdUsd,
  }
}

/** Levers to pull, cheapest first, when the projection gets close. */
export const COST_LEVERS = [
  'Turn on digest-only mode — one message a day instead of one per follow-up.',
  'Increase the overdue reminder interval so a stale lead is chased less often.',
  'Turn off individual reminders and keep only the morning digest.',
  'Turn off screenshot retention so nothing accumulates in storage.',
  'Turn WhatsApp off entirely — the dashboard keeps working as the fallback.',
] as const
