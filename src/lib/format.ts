import { env } from '../config/env.ts'

/**
 * Date formatting for the dashboard.
 *
 * Everything is rendered in the operator's configured zone rather than the
 * browser's, so a follow-up booked for "tomorrow at ten" reads as ten o'clock
 * regardless of where the browser thinks it is.
 */
const DEFAULT_ZONE = env.VITE_DEFAULT_TIME_ZONE

export function formatDateTime(iso: string | null, timeZone: string = DEFAULT_ZONE): string {
  if (iso === null) return '—'

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso))
}

export function formatDate(iso: string | null, timeZone: string = DEFAULT_ZONE): string {
  if (iso === null) return '—'

  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(new Date(iso))
}

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 3_600_000 },
  { unit: 'month', ms: 30 * 24 * 3_600_000 },
  { unit: 'day', ms: 24 * 3_600_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
]

/** "in 3 hours" / "2 days ago" — how overdue work is actually described. */
export function formatRelative(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return '—'

  const deltaMs = new Date(iso).getTime() - now.getTime()
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })

  for (const { unit, ms } of RELATIVE_UNITS) {
    if (Math.abs(deltaMs) >= ms) {
      return formatter.format(Math.round(deltaMs / ms), unit)
    }
  }

  return 'just now'
}

/** ISO date in a specific zone, used to build daily idempotency keys. */
export function localDateKey(date: Date = new Date(), timeZone: string = DEFAULT_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(date)
}
