import { describe, expect, it } from 'vitest'
import { parseWhen } from './command-parser.ts'
import { DEFAULT_SETTINGS } from '../settings.ts'
import { zonedPartsOf } from '../../lib/time-zone.ts'

const SETTINGS = { ...DEFAULT_SETTINGS, timeZone: 'America/Chicago', morningAt: '09:00' }
// 3:00 PM Chicago on 8 Aug 2026 (CDT, UTC-5).
const NOW = new Date('2026-08-08T20:00:00.000Z')

describe('parseWhen', () => {
  it('resolves "tomorrow at 8am" to 08:00 on the next calendar day', () => {
    const result = parseWhen('Follow up tomorrow at 8am', { settings: SETTINGS, now: NOW })

    expect(result).not.toBeNull()
    const parts = zonedPartsOf(new Date(result!.dueAt), SETTINGS.timeZone)
    expect(parts.day).toBe(9)
    expect(parts.hour).toBe(8)
    expect(parts.minute).toBe(0)
    expect(new Date(result!.dueAt).getTime() - NOW.getTime()).not.toBe(24 * 3_600_000)
  })

  it('resolves "tomorrow at 2pm" to 14:00 on the next calendar day', () => {
    const result = parseWhen('tomorrow at 2pm', { settings: SETTINGS, now: NOW })
    const parts = zonedPartsOf(new Date(result!.dueAt), SETTINGS.timeZone)

    expect(parts.day).toBe(9)
    expect(parts.hour).toBe(14)
  })

  it('keeps "in 24 hours" as an exact 24-hour offset', () => {
    const result = parseWhen('in 24 hours', { settings: SETTINGS, now: NOW })

    expect(new Date(result!.dueAt).getTime() - NOW.getTime()).toBe(24 * 3_600_000)
  })

  it('prefers tomorrow-at-time over a relative phrase in the same message', () => {
    const result = parseWhen('in 24 hours tomorrow at 8am', { settings: SETTINGS, now: NOW })
    const parts = zonedPartsOf(new Date(result!.dueAt), SETTINGS.timeZone)

    expect(parts.day).toBe(9)
    expect(parts.hour).toBe(8)
  })
})
