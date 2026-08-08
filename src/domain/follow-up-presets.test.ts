import { describe, expect, it } from 'vitest'
import {
  defaultWaitingDeadline,
  parseLocalDateTimeInput,
  resolvePreset,
  suggestFollowUp,
  toLocalDateTimeInput,
} from './follow-up-presets.ts'
import { DEFAULT_SETTINGS, validateSettings, type UserSettings } from './settings.ts'
import { zonedPartsOf } from '../lib/time-zone.ts'

const SETTINGS: UserSettings = { ...DEFAULT_SETTINGS, timeZone: 'America/Chicago' }
// 10:00 in Chicago on a summer day (CDT, UTC-5).
const NOW = new Date('2026-08-05T15:00:00.000Z')

describe('resolvePreset', () => {
  it('resolves "tomorrow morning" to the configured hour in the operator zone', () => {
    const resolved = resolvePreset('tomorrow_morning', SETTINGS, NOW)
    expect(resolved).not.toBeNull()

    const parts = zonedPartsOf(resolved as Date, SETTINGS.timeZone)
    expect(parts.day).toBe(6)
    expect(parts.hour).toBe(9)
    expect(parts.minute).toBe(0)
  })

  it('resolves "tomorrow afternoon" to the configured afternoon hour', () => {
    const parts = zonedPartsOf(
      resolvePreset('tomorrow_afternoon', SETTINGS, NOW) as Date,
      SETTINGS.timeZone,
    )

    expect(parts.hour).toBe(14)
  })

  it('honours a customised morning time', () => {
    const custom = { ...SETTINGS, morningAt: '07:30' }
    const parts = zonedPartsOf(resolvePreset('tomorrow_morning', custom, NOW) as Date, custom.timeZone)

    expect(parts.hour).toBe(7)
    expect(parts.minute).toBe(30)
  })

  it('rolls "in three days" across a month boundary', () => {
    const endOfMonth = new Date('2026-08-30T15:00:00.000Z')
    const parts = zonedPartsOf(
      resolvePreset('in_three_days', SETTINGS, endOfMonth) as Date,
      SETTINGS.timeZone,
    )

    expect(parts.month).toBe(9)
    expect(parts.day).toBe(2)
  })

  it('keeps the wall-clock hour correct across a daylight saving change', () => {
    // US daylight saving ends on 1 November 2026; scheduling from the day
    // before must still land at 09:00 local, not 08:00 or 10:00.
    const beforeChange = new Date('2026-10-31T15:00:00.000Z')
    const parts = zonedPartsOf(
      resolvePreset('tomorrow_morning', SETTINGS, beforeChange) as Date,
      SETTINGS.timeZone,
    )

    expect(parts.day).toBe(1)
    expect(parts.hour).toBe(9)
  })

  it('makes "later today" relative rather than a fixed hour', () => {
    const resolved = resolvePreset('later_today', SETTINGS, NOW) as Date
    expect(resolved.getTime()).toBe(NOW.getTime() + 3 * 3_600_000)
  })

  it('returns nothing for presets that carry no time of their own', () => {
    expect(resolvePreset('custom', SETTINGS, NOW)).toBeNull()
    expect(resolvePreset('no_further_action', SETTINGS, NOW)).toBeNull()
  })
})

describe('suggestFollowUp', () => {
  it('suggests tomorrow morning on the next calendar day after no answer', () => {
    const suggestion = suggestFollowUp('outbound_call', 'no_answer', SETTINGS, NOW)
    const expected = resolvePreset('tomorrow_morning', SETTINGS, NOW)

    expect(suggestion?.dueAt.getTime()).toBe(expected?.getTime())
    expect(suggestion?.dueAt.getTime()).not.toBe(NOW.getTime() + 24 * 3_600_000)
    expect(suggestion?.recommendedMethod).toBe('phone_call')

    const parts = zonedPartsOf(suggestion!.dueAt, SETTINGS.timeZone)
    expect(parts.day).toBe(6)
    expect(parts.hour).toBe(9)
  })

  it('suggests two calendar days after leaving a voicemail', () => {
    const suggestion = suggestFollowUp('voicemail_left', 'left_voicemail', SETTINGS, NOW)
    const expected = resolvePreset('in_two_days', SETTINGS, NOW)

    expect(suggestion?.dueAt.getTime()).toBe(expected?.getTime())
  })

  it('suggests tomorrow morning after a text with no reply', () => {
    const suggestion = suggestFollowUp('outbound_text', 'no_reply', SETTINGS, NOW)
    const expected = resolvePreset('tomorrow_morning', SETTINGS, NOW)

    expect(suggestion?.dueAt.getTime()).toBe(expected?.getTime())
  })

  it('suggests two calendar days after an email with no reply', () => {
    const suggestion = suggestFollowUp('outbound_email', 'no_reply', SETTINGS, NOW)
    const expected = resolvePreset('in_two_days', SETTINGS, NOW)

    expect(suggestion?.dueAt.getTime()).toBe(expected?.getTime())
  })

  it('suggests an appointment reminder when an appointment is set', () => {
    const suggestion = suggestFollowUp('outbound_call', 'appointment_set', SETTINGS, NOW)

    expect(suggestion?.preset).toBe('appointment')
    // Appointment lead time stays a relative offset, not a calendar preset.
    expect(suggestion?.dueAt.getTime()).toBe(NOW.getTime() + 24 * 3_600_000)
  })

  it('suggests nothing once the outcome closes the lead', () => {
    expect(suggestFollowUp('outbound_call', 'sold', SETTINGS, NOW)).toBeNull()
    expect(suggestFollowUp('outbound_call', 'not_interested', SETTINGS, NOW)).toBeNull()
  })

  it('keeps sub-day intervals relative rather than snapping to tomorrow morning', () => {
    const fast = { ...SETTINGS, noAnswerFollowUpHours: 4 }
    const suggestion = suggestFollowUp('outbound_call', 'no_answer', fast, NOW)

    expect(suggestion?.dueAt.getTime()).toBe(NOW.getTime() + 4 * 3_600_000)
  })

  it('honours a custom morning time for day-aligned no-answer follow-ups', () => {
    const custom = { ...SETTINGS, morningAt: '08:00' }
    const suggestion = suggestFollowUp('outbound_call', 'no_answer', custom, NOW)
    const parts = zonedPartsOf(suggestion!.dueAt, custom.timeZone)

    expect(parts.day).toBe(6)
    expect(parts.hour).toBe(8)
    expect(parts.minute).toBe(0)
  })
})

describe('defaultWaitingDeadline', () => {
  it('is always in the future, so waiting can never be open-ended', () => {
    const deadline = defaultWaitingDeadline(SETTINGS, NOW)

    expect(deadline.getTime()).toBeGreaterThan(NOW.getTime())
    expect(deadline.getTime()).toBe(NOW.getTime() + SETTINGS.waitingTimeoutHours * 3_600_000)
  })
})

describe('datetime-local round trip', () => {
  it('survives a round trip through the input format', () => {
    const formatted = toLocalDateTimeInput(NOW, SETTINGS.timeZone)
    const parsed = parseLocalDateTimeInput(formatted, SETTINGS.timeZone)

    expect(parsed?.getTime()).toBe(NOW.getTime())
  })

  it('rejects an empty or malformed value rather than defaulting to the epoch', () => {
    expect(parseLocalDateTimeInput('', SETTINGS.timeZone)).toBeNull()
    expect(parseLocalDateTimeInput('not a date', SETTINGS.timeZone)).toBeNull()
    expect(parseLocalDateTimeInput('2026-13-01T10:00', SETTINGS.timeZone)).toBeNull()
  })
})

describe('validateSettings', () => {
  it('keeps the previous value when an interval is out of range', () => {
    const result = validateSettings({ ...SETTINGS, waitingTimeoutHours: 0 }, SETTINGS)

    expect(result.errors.waitingTimeoutHours).toBeDefined()
    expect(result.settings.waitingTimeoutHours).toBe(SETTINGS.waitingTimeoutHours)
  })

  it('rejects an unrecognised time zone', () => {
    const result = validateSettings({ ...SETTINGS, timeZone: 'Mars/Olympus' }, SETTINGS)

    expect(result.errors.timeZone).toBeDefined()
    expect(result.settings.timeZone).toBe(SETTINGS.timeZone)
  })

  it('rejects a malformed time of day', () => {
    const result = validateSettings({ ...SETTINGS, morningAt: '25:00' }, SETTINGS)

    expect(result.errors.morningAt).toBeDefined()
    expect(result.settings.morningAt).toBe(SETTINGS.morningAt)
  })

  it('accepts valid settings unchanged', () => {
    const candidate = { ...SETTINGS, morningAt: '08:15', waitingTimeoutHours: 48 }
    const result = validateSettings(candidate, SETTINGS)

    expect(result.errors).toEqual({})
    expect(result.settings).toEqual(candidate)
  })
})
