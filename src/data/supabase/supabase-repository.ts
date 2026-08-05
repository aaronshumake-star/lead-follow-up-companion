/**
 * Supabase-backed repository.
 *
 * Everything here runs through the anon key with Row Level Security applied, so
 * a query can only ever see the signed-in user's rows. The repository adds
 * convenience, never authority.
 *
 * Operations that must be atomic — closing one follow-up while opening the next
 * — call the SQL functions added in
 * supabase/migrations/20260806000100_phase2_manual_tracker.sql rather than
 * issuing two round trips, because the one-open-follow-up unique index makes a
 * two-step version unsafe.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '../../domain/models.ts'
import type { LeadStatus } from '../../domain/vocabulary.ts'
import { isClosedLeadStatus } from '../../domain/vocabulary.ts'
import type { UserSettings } from '../../domain/settings.ts'
import { normalizeEmail, normalizeName, normalizePhone } from '../../lib/normalize.ts'
import type {
  ActivityDraft,
  ActivityPatch,
  ContactMethodDraft,
  CustomerDraft,
  CustomerPatch,
  FollowUpPlan,
  Repository,
  ScheduleFollowUpInput,
  VehicleInterestDraft,
  WorkspaceSnapshot,
} from '../workspace.ts'
import {
  definedOnly,
  toActivity,
  toAuditEntry,
  toContactMethod,
  toCustomer,
  toFollowUp,
  toProfile,
  toVehicleInterest,
} from './mappers.ts'

/**
 * Ceiling on the activity ledger fetched per load. A personal pipeline will not
 * approach this; if it ever did, the honest fix is per-customer paging rather
 * than a silently truncated timeline.
 */
const ACTIVITY_FETCH_LIMIT = 5000

export class SupabaseRepository implements Repository {
  readonly mode = 'supabase' as const

  // Declared explicitly rather than as constructor parameter properties, which
  // erasableSyntaxOnly disallows.
  private readonly client: SupabaseClient
  private readonly userId: string

  constructor(client: SupabaseClient, userId: string) {
    this.client = client
    this.userId = userId
  }

  async load(): Promise<WorkspaceSnapshot> {
    const [profile, customers, contactMethods, vehicleInterests, activities, followUps, auditEntries] =
      await Promise.all([
        this.loadProfile(),
        this.selectAll('customers', 'updated_at'),
        this.selectAll('customer_contact_methods', 'created_at'),
        this.selectAll('vehicle_interests', 'created_at'),
        this.selectAll('activities', 'occurred_at', ACTIVITY_FETCH_LIMIT),
        this.selectAll('follow_ups', 'due_at'),
        this.selectAll('audit_log', 'created_at', 500),
      ])

    return {
      profile,
      customers: customers.map(toCustomer),
      contactMethods: contactMethods.map(toContactMethod),
      vehicleInterests: vehicleInterests.map(toVehicleInterest),
      activities: activities.map(toActivity),
      followUps: followUps.map(toFollowUp),
      auditEntries: auditEntries.map(toAuditEntry),
    }
  }

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------

  async createCustomer(draft: CustomerDraft): Promise<string> {
    const status = draft.leadStatus ?? 'new'

    const { data, error } = await this.client
      .from('customers')
      .insert({
        user_id: this.userId,
        full_name: draft.fullName.trim(),
        first_name: nullableText(draft.firstName),
        last_name: nullableText(draft.lastName),
        primary_phone: nullableText(draft.primaryPhone),
        primary_email: nullableText(draft.primaryEmail),
        dealership_customer_id: nullableText(draft.dealershipCustomerId),
        city: nullableText(draft.city),
        state: nullableText(draft.state)?.toUpperCase() ?? null,
        preferred_language: draft.preferredLanguage ?? 'unknown',
        preferred_contact_method: draft.preferredContactMethod ?? null,
        salesperson: nullableText(draft.salesperson),
        lead_source: nullableText(draft.leadSource),
        lead_priority: draft.leadPriority ?? 'normal',
        lead_temperature: draft.leadTemperature ?? 'unknown',
        lead_status: status,
        notes: nullableText(draft.notes),
        pinned_note: nullableText(draft.pinnedNote),
        objections: nullableText(draft.objections),
        trade_notes: nullableText(draft.tradeNotes),
        finance_status: nullableText(draft.financeStatus),
        source: 'manual',
        // The archived status and the timestamp must agree.
        archived_at: status === 'archived' ? new Date().toISOString() : null,
      })
      .select('id')
      .single()

    unwrap(error, 'Could not create the customer')
    const id = (data as { id: string }).id

    // A phone or email typed on the form is also a usable channel.
    const phone = nullableText(draft.primaryPhone)
    const email = nullableText(draft.primaryEmail)
    const methods: Array<Record<string, unknown>> = []

    if (phone !== null) {
      methods.push(
        { user_id: this.userId, customer_id: id, method: 'phone_call', value: phone, is_primary: true },
        { user_id: this.userId, customer_id: id, method: 'sms', value: phone, is_primary: true },
      )
    }
    if (email !== null) {
      methods.push({
        user_id: this.userId,
        customer_id: id,
        method: 'email',
        value: email,
        is_primary: true,
      })
    }

    if (methods.length > 0) {
      const { error: methodError } = await this.client.from('customer_contact_methods').insert(methods)
      unwrap(methodError, 'Customer created, but its contact methods could not be saved')
    }

    return id
  }

  async updateCustomer(customerId: string, patch: CustomerPatch): Promise<void> {
    const { leadStatus, ...rest } = patch

    const payload = definedOnly({
      full_name: rest.fullName === undefined ? undefined : rest.fullName.trim(),
      first_name: mapNullable(rest.firstName),
      last_name: mapNullable(rest.lastName),
      primary_phone: mapNullable(rest.primaryPhone),
      primary_email: mapNullable(rest.primaryEmail),
      dealership_customer_id: mapNullable(rest.dealershipCustomerId),
      city: mapNullable(rest.city),
      state: rest.state === undefined ? undefined : (nullableText(rest.state)?.toUpperCase() ?? null),
      preferred_language: rest.preferredLanguage,
      preferred_contact_method: rest.preferredContactMethod,
      salesperson: mapNullable(rest.salesperson),
      lead_source: mapNullable(rest.leadSource),
      lead_priority: rest.leadPriority,
      lead_temperature: rest.leadTemperature,
      notes: mapNullable(rest.notes),
      pinned_note: mapNullable(rest.pinnedNote),
      objections: mapNullable(rest.objections),
      trade_notes: mapNullable(rest.tradeNotes),
      finance_status: mapNullable(rest.financeStatus),
    })

    if (Object.keys(payload).length > 0) {
      const { error } = await this.client.from('customers').update(payload).eq('id', customerId)
      unwrap(error, 'Could not save the customer')
    }

    // Status moves go through setLeadStatus so the side effects always run.
    if (leadStatus !== undefined) await this.setLeadStatus(customerId, leadStatus)
  }

  async setLeadStatus(customerId: string, status: LeadStatus, note?: string | null): Promise<void> {
    const { error } = await this.client
      .from('customers')
      .update({
        lead_status: status,
        archived_at: status === 'archived' ? new Date().toISOString() : null,
      })
      .eq('id', customerId)

    unwrap(error, 'Could not change the customer status')

    // A closed customer has no outstanding commitment, so the open follow-up is
    // canceled rather than left to surface in the overdue queue forever.
    if (isClosedLeadStatus(status)) {
      const { error: closeError } = await this.client.rpc('close_open_follow_up', {
        p_customer_id: customerId,
        p_resolution: 'cancel',
        p_note: note ?? `Customer marked ${status}`,
      })
      unwrap(closeError, 'Status changed, but the open follow-up could not be closed')
    }

    await this.insertActivity({
      customerId,
      type: 'status_change',
      direction: 'internal',
      summary: note ?? `Status changed to ${status}`,
      performedByUser: false,
    })
  }

  async archiveCustomer(customerId: string): Promise<void> {
    await this.setLeadStatus(customerId, 'archived', 'Archived')
  }

  async restoreCustomer(customerId: string, status: LeadStatus): Promise<void> {
    await this.setLeadStatus(customerId, status, 'Restored from archive')
  }

  async deleteCustomer(customerId: string): Promise<void> {
    const { error } = await this.client.from('customers').delete().eq('id', customerId)
    unwrap(error, 'Could not delete the customer')
  }

  // -------------------------------------------------------------------------
  // Contact methods and vehicle interests
  // -------------------------------------------------------------------------

  async addContactMethod(customerId: string, draft: ContactMethodDraft): Promise<void> {
    if (draft.isPrimary === true) await this.clearPrimaryMethods(customerId, draft.method)

    const { error } = await this.client.from('customer_contact_methods').insert({
      user_id: this.userId,
      customer_id: customerId,
      method: draft.method,
      value: draft.value.trim(),
      label: nullableText(draft.label),
      is_primary: draft.isPrimary ?? false,
      is_verified: draft.isVerified ?? false,
      opted_out: draft.optedOut ?? false,
      source: 'manual',
    })

    // The unique index is the real guard; this turns it into a readable message.
    if (error?.code === '23505') {
      throw new Error('That contact method is already on file for this customer.')
    }
    unwrap(error, 'Could not add the contact method')
  }

  async updateContactMethod(
    contactMethodId: string,
    patch: Partial<ContactMethodDraft>,
  ): Promise<void> {
    const { error } = await this.client
      .from('customer_contact_methods')
      .update(
        definedOnly({
          value: patch.value === undefined ? undefined : patch.value.trim(),
          label: mapNullable(patch.label),
          is_primary: patch.isPrimary,
          is_verified: patch.isVerified,
          opted_out: patch.optedOut,
        }),
      )
      .eq('id', contactMethodId)

    unwrap(error, 'Could not update the contact method')
  }

  async removeContactMethod(contactMethodId: string): Promise<void> {
    const { error } = await this.client
      .from('customer_contact_methods')
      .delete()
      .eq('id', contactMethodId)

    unwrap(error, 'Could not remove the contact method')
  }

  async saveVehicleInterest(
    customerId: string,
    draft: VehicleInterestDraft,
    vehicleInterestId?: string,
  ): Promise<void> {
    if (draft.isPrimary === true) {
      const { error } = await this.client
        .from('vehicle_interests')
        .update({ is_primary: false })
        .eq('customer_id', customerId)
      unwrap(error, 'Could not update the vehicle interests')
    }

    const payload = definedOnly({
      model_year: draft.modelYear,
      make: mapNullable(draft.make),
      model: mapNullable(draft.model),
      floorplan: mapNullable(draft.floorplan),
      stock_number: mapNullable(draft.stockNumber),
      condition: draft.condition,
      is_primary: draft.isPrimary,
      notes: mapNullable(draft.notes),
    })

    if (vehicleInterestId !== undefined) {
      const { error } = await this.client
        .from('vehicle_interests')
        .update(payload)
        .eq('id', vehicleInterestId)
      unwrap(error, 'Could not save the vehicle interest')
      return
    }

    const { error } = await this.client
      .from('vehicle_interests')
      .insert({ ...payload, user_id: this.userId, customer_id: customerId })
    unwrap(error, 'Could not add the vehicle interest')
  }

  async removeVehicleInterest(vehicleInterestId: string): Promise<void> {
    const { error } = await this.client.from('vehicle_interests').delete().eq('id', vehicleInterestId)
    unwrap(error, 'Could not remove the vehicle interest')
  }

  // -------------------------------------------------------------------------
  // Activities
  // -------------------------------------------------------------------------

  async logActivity(draft: ActivityDraft, plan: FollowUpPlan = { kind: 'none' }): Promise<void> {
    const occurredAt = draft.occurredAt ?? new Date().toISOString()
    await this.insertActivity({ ...draft, occurredAt })

    const { error: touchError } = await this.client
      .from('customers')
      .update({ last_activity_at: occurredAt })
      .eq('id', draft.customerId)
    unwrap(touchError, 'Activity saved, but the customer could not be updated')

    // A customer who replied is no longer someone to wait on.
    if (draft.direction === 'inbound') {
      const { error } = await this.client.rpc('clear_waiting_on_response', {
        p_customer_id: draft.customerId,
        p_now: occurredAt,
      })
      unwrap(error, 'Activity saved, but the waiting state could not be cleared')
    }

    await this.applyPlan(draft.customerId, plan)
  }

  async updateActivity(
    activityId: string,
    patch: ActivityPatch,
    reason?: string | null,
  ): Promise<void> {
    const { data: existing, error: readError } = await this.client
      .from('activities')
      .select('*')
      .eq('id', activityId)
      .single()
    unwrap(readError, 'Could not load the activity')

    const before = toActivity(existing as Record<string, unknown>)
    const direction = patch.direction ?? before.direction

    const { error } = await this.client
      .from('activities')
      .update(
        definedOnly({
          type: patch.type,
          direction: patch.direction,
          method: patch.method,
          outcome: patch.outcome,
          summary: mapNullable(patch.summary),
          occurred_at: patch.occurredAt,
          // An internal activity can never be a personal attempt.
          performed_by_user: direction === 'internal' ? false : patch.performedByUser,
        }),
      )
      .eq('id', activityId)
    unwrap(error, 'Could not save the correction')

    // Corrections are recorded rather than applied silently. audit_log is
    // insert-only, so this entry can never be edited away afterwards.
    const { error: auditError } = await this.client.from('audit_log').insert({
      user_id: this.userId,
      action: 'update',
      table_name: 'activities',
      record_id: activityId,
      summary: 'Activity corrected',
      metadata: {
        before: {
          type: before.type,
          direction: before.direction,
          method: before.method,
          outcome: before.outcome,
          summary: before.summary,
          occurredAt: before.occurredAt,
          performedByUser: before.performedByUser,
        },
        after: definedOnly({ ...patch }),
        reason: reason ?? null,
      },
      source: 'manual',
    })
    unwrap(auditError, 'Correction saved, but the audit entry could not be written')
  }

  // -------------------------------------------------------------------------
  // Follow-ups
  // -------------------------------------------------------------------------

  async scheduleFollowUp(input: ScheduleFollowUpInput): Promise<void> {
    const { error } = await this.client.rpc('schedule_follow_up', {
      p_customer_id: input.customerId,
      p_due_at: input.dueAt,
      p_reason: input.reason ?? null,
      p_recommended_method: input.recommendedMethod ?? null,
      p_priority: input.priority ?? 'normal',
      p_waiting_until: input.waitingUntil ?? null,
      p_is_appointment: input.isAppointment ?? false,
      p_resolution: input.resolution ?? 'reschedule',
      p_resolution_note: input.resolutionNote ?? null,
      p_source: 'manual',
    })
    unwrap(error, 'Could not schedule the follow-up')

    // Keep the lead status in step with the commitment that now exists.
    const waiting = input.waitingUntil !== null && input.waitingUntil !== undefined
    const status: LeadStatus = waiting
      ? 'waiting_on_customer'
      : input.isAppointment === true
        ? 'appointment_scheduled'
        : 'follow_up_scheduled'

    const { error: statusError } = await this.client
      .from('customers')
      .update({ lead_status: status })
      .eq('id', input.customerId)
      .not('lead_status', 'in', '("sold","lost","do_not_contact","archived")')
    unwrap(statusError, 'Follow-up scheduled, but the customer status could not be updated')
  }

  async completeFollowUp(customerId: string, note?: string | null): Promise<void> {
    const { data, error } = await this.client.rpc('close_open_follow_up', {
      p_customer_id: customerId,
      p_resolution: 'complete',
      p_note: note ?? null,
    })
    unwrap(error, 'Could not complete the follow-up')

    if (data !== null) {
      await this.insertActivity({
        customerId,
        type: 'follow_up_completed',
        direction: 'internal',
        summary: note ?? 'Follow-up completed',
        performedByUser: false,
      })
    }
  }

  async cancelFollowUp(customerId: string, note?: string | null): Promise<void> {
    const { error } = await this.client.rpc('close_open_follow_up', {
      p_customer_id: customerId,
      p_resolution: 'cancel',
      p_note: note ?? null,
    })
    unwrap(error, 'Could not cancel the follow-up')
  }

  async snoozeFollowUp(followUpId: string, snoozedUntil: string): Promise<void> {
    const { error } = await this.client
      .from('follow_ups')
      .update({ status: 'snoozed', snoozed_until: snoozedUntil, waiting_until: null })
      .eq('id', followUpId)

    unwrap(error, 'Could not snooze the follow-up')
  }

  async expireWaitingFollowUps(now: Date = new Date()): Promise<number> {
    const { data, error } = await this.client.rpc('expire_waiting_follow_ups', {
      p_now: now.toISOString(),
    })
    unwrap(error, 'Could not refresh lapsed waiting deadlines')

    return typeof data === 'number' ? data : 0
  }

  // -------------------------------------------------------------------------
  // Profile and settings
  // -------------------------------------------------------------------------

  async updateSettings(patch: Partial<UserSettings>): Promise<void> {
    const { error } = await this.client
      .from('profiles')
      .update(
        definedOnly({
          time_zone: patch.timeZone,
          morning_at: patch.morningAt,
          afternoon_at: patch.afternoonAt,
          no_answer_follow_up_hours: patch.noAnswerFollowUpHours,
          voicemail_follow_up_hours: patch.voicemailFollowUpHours,
          text_no_reply_follow_up_hours: patch.textNoReplyFollowUpHours,
          email_no_reply_follow_up_hours: patch.emailNoReplyFollowUpHours,
          quote_sent_follow_up_hours: patch.quoteSentFollowUpHours,
          waiting_timeout_hours: patch.waitingTimeoutHours,
          default_lead_priority: patch.defaultLeadPriority,
          date_time_display: patch.dateTimeDisplay,
        }),
      )
      .eq('id', this.userId)

    unwrap(error, 'Could not save your settings')
  }

  async updateProfile(patch: Partial<Pick<Profile, 'displayName'>>): Promise<void> {
    const { error } = await this.client
      .from('profiles')
      .update(definedOnly({ display_name: mapNullable(patch.displayName) }))
      .eq('id', this.userId)

    unwrap(error, 'Could not save your profile')
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async applyPlan(customerId: string, plan: FollowUpPlan): Promise<void> {
    switch (plan.kind) {
      case 'none':
        return

      case 'complete':
        await this.completeFollowUp(customerId, plan.note ?? null)
        return

      case 'schedule':
        await this.scheduleFollowUp({
          customerId,
          dueAt: plan.dueAt,
          reason: plan.reason ?? null,
          recommendedMethod: plan.recommendedMethod ?? null,
          priority: plan.priority,
          isAppointment: plan.isAppointment ?? false,
          resolution: plan.resolution,
          resolutionNote: plan.resolutionNote ?? null,
        })
        return

      case 'waiting':
        await this.scheduleFollowUp({
          customerId,
          dueAt: plan.waitingUntil,
          waitingUntil: plan.waitingUntil,
          reason: plan.reason ?? 'Waiting for the customer to respond',
          resolution: plan.resolution,
          resolutionNote: plan.resolutionNote ?? null,
        })
        return

      case 'close':
        await this.setLeadStatus(customerId, plan.leadStatus, plan.note ?? null)
    }
  }

  private async insertActivity(draft: ActivityDraft): Promise<void> {
    const { error } = await this.client.from('activities').insert({
      user_id: this.userId,
      customer_id: draft.customerId,
      type: draft.type,
      direction: draft.direction,
      method: draft.method ?? null,
      outcome: draft.outcome ?? null,
      summary: nullableText(draft.summary),
      occurred_at: draft.occurredAt ?? new Date().toISOString(),
      source: draft.source ?? 'manual',
      // Internal rows are never personal contact attempts.
      performed_by_user: draft.direction === 'internal' ? false : draft.performedByUser,
    })

    unwrap(error, 'Could not record the activity')
  }

  private async clearPrimaryMethods(customerId: string, method: string): Promise<void> {
    const { error } = await this.client
      .from('customer_contact_methods')
      .update({ is_primary: false })
      .eq('customer_id', customerId)
      .eq('method', method)

    unwrap(error, 'Could not update the existing contact methods')
  }

  private async loadProfile(): Promise<Profile> {
    const { data, error } = await this.client.from('profiles').select('*').eq('id', this.userId).single()
    unwrap(error, 'Could not load your profile')

    return toProfile(data as Record<string, unknown>)
  }

  private async selectAll(
    table: string,
    orderBy: string,
    limit?: number,
  ): Promise<Array<Record<string, unknown>>> {
    // RLS restricts this to the signed-in user's rows; no user_id filter is
    // needed and adding one would imply the policy were optional.
    let query = this.client.from(table).select('*').order(orderBy, { ascending: false })
    if (limit !== undefined) query = query.limit(limit)

    const { data, error } = await query
    unwrap(error, `Could not load ${table.replace(/_/g, ' ')}`)

    return (data ?? []) as Array<Record<string, unknown>>
  }
}

/**
 * Turns a PostgREST error into a thrown Error with a message safe to show.
 *
 * The provider's own text can echo row contents, so only a fixed description is
 * surfaced; the detail stays in the browser's network tab where it is useful
 * for debugging but never rendered or logged.
 */
function unwrap(error: { message: string; code?: string } | null, description: string): void {
  if (error === null) return
  throw new Error(description)
}

function nullableText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Preserves "not provided" as undefined while allowing an explicit null. */
function mapNullable(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : nullableText(value)
}

/** Re-exported for tests that need the same normalization the repository uses. */
export const normalizers = { normalizeName, normalizePhone, normalizeEmail }
