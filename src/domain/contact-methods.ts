/**
 * Communication accounting.
 *
 * Three concepts are kept strictly apart, because conflating them is how a lead
 * gets dropped while the CRM looks busy:
 *
 *   1. Methods available   — channels that exist for this customer.
 *   2. Activity visible    — anything in the ledger, including rows imported
 *                            from a CRM screenshot that someone else generated.
 *   3. Methods attempted   — channels *I* personally used. Only activities with
 *                            performedByUser === true count.
 *
 * An outbound email showing in a screenshot does not mean I emailed them. That
 * distinction is why `attempted` filters on performedByUser and nothing else.
 */

import type { Activity, CustomerContactMethod, IsoTimestamp } from './models.ts'
import type { ContactMethod } from './vocabulary.ts'

export interface ContactMethodSummary {
  methodsAvailable: ContactMethod[]
  /** Channels I personally used. Screenshot-visible activity is excluded. */
  methodsAttempted: ContactMethod[]
  methodsNotAttempted: ContactMethod[]
  lastOutboundAttemptAt: IsoTimestamp | null
  lastInboundResponseAt: IsoTimestamp | null
  /** Count of attempts I made, not of all activity on the record. */
  totalAttempts: number
  recommendedNextMethod: ContactMethod | null
  recommendationReason: string
}

/**
 * Order to reach for channels in. A phone call is the highest-signal attempt,
 * text is the cheapest to answer, and email is the easiest to ignore.
 * `other` is never recommended because the app cannot describe what it is.
 */
const METHOD_PREFERENCE: readonly ContactMethod[] = [
  'phone_call',
  'sms',
  'whatsapp',
  'email',
  'in_person',
  'voicemail',
]

function sortByPreference(methods: readonly ContactMethod[]): ContactMethod[] {
  return [...methods].sort((a, b) => {
    const aRank = METHOD_PREFERENCE.indexOf(a)
    const bRank = METHOD_PREFERENCE.indexOf(b)
    return (aRank === -1 ? Number.MAX_SAFE_INTEGER : aRank) - (bRank === -1 ? Number.MAX_SAFE_INTEGER : bRank)
  })
}

function latest(a: IsoTimestamp | null, b: IsoTimestamp): IsoTimestamp {
  return a === null || b > a ? b : a
}

export function summarizeContactMethods(
  contactMethods: readonly CustomerContactMethod[],
  activities: readonly Activity[],
): ContactMethodSummary {
  // An opted-out channel still exists on the record but is not usable, so it is
  // excluded from availability and can never be recommended.
  const available = new Set<ContactMethod>(
    contactMethods.filter((method) => !method.optedOut).map((method) => method.method),
  )

  const attempted = new Set<ContactMethod>()
  const lastAttemptByMethod = new Map<ContactMethod, IsoTimestamp>()
  let lastOutboundAttemptAt: IsoTimestamp | null = null
  let lastInboundResponseAt: IsoTimestamp | null = null
  let totalAttempts = 0

  for (const activity of activities) {
    if (activity.direction === 'inbound') {
      lastInboundResponseAt = latest(lastInboundResponseAt, activity.occurredAt)
    }

    // The single check that separates "I tried" from "the CRM shows something".
    if (!activity.performedByUser) continue

    totalAttempts += 1

    if (activity.direction === 'outbound') {
      lastOutboundAttemptAt = latest(lastOutboundAttemptAt, activity.occurredAt)
    }

    if (activity.method !== null) {
      attempted.add(activity.method)
      const previous = lastAttemptByMethod.get(activity.method)
      lastAttemptByMethod.set(
        activity.method,
        previous === undefined ? activity.occurredAt : latest(previous, activity.occurredAt),
      )
    }
  }

  const methodsAvailable = sortByPreference([...available])
  const methodsAttempted = sortByPreference([...attempted])
  const methodsNotAttempted = methodsAvailable.filter((method) => !attempted.has(method))

  const { method: recommendedNextMethod, reason: recommendationReason } = recommendNextMethod(
    methodsAvailable,
    methodsNotAttempted,
    lastAttemptByMethod,
  )

  return {
    methodsAvailable,
    methodsAttempted,
    methodsNotAttempted,
    lastOutboundAttemptAt,
    lastInboundResponseAt,
    totalAttempts,
    recommendedNextMethod,
    recommendationReason,
  }
}

function recommendNextMethod(
  methodsAvailable: readonly ContactMethod[],
  methodsNotAttempted: readonly ContactMethod[],
  lastAttemptByMethod: ReadonlyMap<ContactMethod, IsoTimestamp>,
): { method: ContactMethod | null; reason: string } {
  if (methodsAvailable.length === 0) {
    return { method: null, reason: 'No usable contact method on file' }
  }

  // Prefer a channel that has never been tried: a customer who ignores calls may
  // simply be someone who answers texts.
  const untried = methodsNotAttempted[0]
  if (untried !== undefined) {
    return { method: untried, reason: 'Not tried yet' }
  }

  // Everything has been tried, so return to whichever channel has gone coldest.
  let stalest: ContactMethod | null = null
  let stalestAt: IsoTimestamp | null = null

  for (const method of methodsAvailable) {
    const attemptedAt = lastAttemptByMethod.get(method)
    if (attemptedAt === undefined) continue
    if (stalestAt === null || attemptedAt < stalestAt) {
      stalest = method
      stalestAt = attemptedAt
    }
  }

  if (stalest === null) {
    return { method: methodsAvailable[0] ?? null, reason: 'Only channel available' }
  }

  return { method: stalest, reason: 'Longest since last attempt' }
}
