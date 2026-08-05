/**
 * The follow-up a screenshot import creates.
 *
 * The point of importing a lead is that it becomes impossible to forget, so an
 * import that leaves a customer with no next action has not really done its job.
 * These rules give every active imported customer a commitment, using the
 * operator's configured times rather than hard-coded ones.
 *
 * The existing one-open-follow-up rule is respected rather than worked around:
 * a customer who already has an open follow-up keeps it. Replacing it would
 * throw away a deliberate decision in favour of a default.
 */

import type { Customer, FollowUp } from '../models.ts'
import { findOpenFollowUp } from '../next-action.ts'
import { isClosedLeadStatus } from '../vocabulary.ts'
import type { UserSettings } from '../settings.ts'
import { atZonedTime, zonedPartsOf } from '../../lib/time-zone.ts'

export type AutoFollowUpReason =
  | 'new_lead_same_day'
  | 'new_lead_next_morning'
  | 'existing_lead_next_morning'
  | 'kept_existing'
  | 'customer_closed'
  | 'disabled'

export interface AutoFollowUpPlan {
  /** Null when nothing should be scheduled. */
  dueAt: Date | null
  reason: AutoFollowUpReason
  /** Short line for the import summary and the follow-up's own reason field. */
  description: string
}

export function planAutoFollowUp(
  customer: Pick<Customer, 'leadStatus'>,
  existingFollowUps: readonly FollowUp[],
  settings: UserSettings,
  options: { isNewCustomer: boolean; now?: Date },
): AutoFollowUpPlan {
  const now = options.now ?? new Date()

  if (!settings.autoFollowUpOnImport) {
    return { dueAt: null, reason: 'disabled', description: 'Automatic follow-up is turned off' }
  }

  // Sold, lost, do-not-contact and archived customers have no obligation left.
  if (isClosedLeadStatus(customer.leadStatus)) {
    return { dueAt: null, reason: 'customer_closed', description: 'Customer is closed' }
  }

  // A deliberate commitment outranks a default one.
  const open = findOpenFollowUp(existingFollowUps)
  if (open !== null) {
    return { dueAt: null, reason: 'kept_existing', description: 'Existing follow-up kept' }
  }

  if (options.isNewCustomer) {
    const { hour } = zonedPartsOf(now, settings.timeZone)

    // A lead that arrives during the working day deserves a same-day attempt;
    // one arriving in the evening would only produce a reminder nobody can act
    // on, so it waits for the morning.
    if (hour < settings.newLeadSameDayCutoffHour) {
      return {
        dueAt: new Date(now.getTime() + settings.sameDayFollowUpDelayHours * 3_600_000),
        reason: 'new_lead_same_day',
        description: 'New lead — first contact later today',
      }
    }

    return {
      dueAt: atZonedTime(now, settings.timeZone, 1, settings.morningAt),
      reason: 'new_lead_next_morning',
      description: 'New lead — first contact tomorrow morning',
    }
  }

  return {
    dueAt: atZonedTime(now, settings.timeZone, 1, settings.morningAt),
    reason: 'existing_lead_next_morning',
    description: 'Imported from a screenshot with no next action',
  }
}
