/**
 * Time-zone arithmetic.
 *
 * "Tomorrow at ten" has to mean ten o'clock where the operator is, not where
 * the browser happens to be, and "due today" has to agree with the wall
 * calendar on the desk. Everything here works in a named IANA zone rather than
 * the host zone.
 *
 * Implemented with Intl rather than a date library: it is a few dozen lines,
 * it handles daylight saving correctly, and it keeps the bundle small.
 */

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = PART_FORMATTERS.get(timeZone)
  if (cached !== undefined) return cached

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  PART_FORMATTERS.set(timeZone, formatter)
  return formatter
}

/** The wall-clock reading in `timeZone` at a given instant. */
export function zonedPartsOf(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type)
    return found === undefined ? 0 : Number.parseInt(found.value, 10)
  }

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  }
}

/** Offset from UTC in milliseconds that `timeZone` was using at `date`. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedPartsOf(date, timeZone)
  const secondsPart = formatterFor(timeZone)
    .formatToParts(date)
    .find((part) => part.type === 'second')
  const seconds = secondsPart === undefined ? 0 : Number.parseInt(secondsPart.value, 10)

  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, seconds)
  // Milliseconds are not in the formatted output, so compare on whole seconds.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * The instant at which the clock in `timeZone` reads the given wall time.
 *
 * The offset is applied twice because the first guess can straddle a daylight
 * saving boundary — resolving 02:30 on a spring-forward morning needs the
 * offset that applies *after* the correction, not before it.
 */
export function zonedWallTimeToInstant(parts: ZonedParts, timeZone: string): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const firstGuess = new Date(naive - timeZoneOffsetMs(new Date(naive), timeZone))
  const corrected = new Date(naive - timeZoneOffsetMs(firstGuess, timeZone))

  return corrected
}

/** Parses "HH:MM", falling back to midnight rather than producing NaN. */
export function parseWallClock(value: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (match === null) return { hour: 0, minute: 0 }

  return { hour: Number.parseInt(match[1] ?? '0', 10), minute: Number.parseInt(match[2] ?? '0', 10) }
}

/** The instant `days` from now at a specific wall-clock time in `timeZone`. */
export function atZonedTime(
  from: Date,
  timeZone: string,
  dayOffset: number,
  wallClock: string,
): Date {
  const today = zonedPartsOf(from, timeZone)
  const { hour, minute } = parseWallClock(wallClock)

  // Date.UTC normalises overflow, so day + 3 rolls into the next month cleanly.
  const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset))
  const shiftedParts = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour,
    minute,
  }

  return zonedWallTimeToInstant(shiftedParts, timeZone)
}

/** Midnight at the start of the day containing `date`, in `timeZone`. */
export function startOfZonedDay(date: Date, timeZone: string): Date {
  const parts = zonedPartsOf(date, timeZone)
  return zonedWallTimeToInstant({ ...parts, hour: 0, minute: 0 }, timeZone)
}

/** "YYYY-MM-DD" as the calendar in `timeZone` reads it. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = zonedPartsOf(date, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** True when both instants fall on the same calendar day in `timeZone`. */
export function isSameZonedDay(a: Date, b: Date, timeZone: string): boolean {
  return zonedDateKey(a, timeZone) === zonedDateKey(b, timeZone)
}

/** Days between two instants by calendar date, ignoring the time of day. */
export function zonedDayDifference(from: Date, to: Date, timeZone: string): number {
  const fromMidnight = startOfZonedDay(from, timeZone).getTime()
  const toMidnight = startOfZonedDay(to, timeZone).getTime()

  return Math.round((toMidnight - fromMidnight) / 86_400_000)
}
