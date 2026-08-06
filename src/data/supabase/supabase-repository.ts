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
  toClarificationSession,
  toContactMethod,
  toCustomer,
  toExtractionField,
  toFollowUp,
  toNotification,
  toProfile,
  toScreenshot,
  toStoredMatchCandidate,
  toUsageEvent,
  toVehicleInterest,
  toVoiceRecord,
} from './mappers.ts'
import type { ApplyImportInput, ImportOutcome, ResolveReviewInput } from '../workspace.ts'
import type { ScreenshotExtractionField, UsageEventKind } from '../../domain/models.ts'
import type { ImportDecision } from '../../domain/screenshot/decision-engine.ts'
import { isAutomatic } from '../../domain/screenshot/decision-engine.ts'
import { applyCorrections, buildImportPlan } from '../../domain/screenshot/import-plan.ts'
import { planAutoFollowUp } from '../../domain/screenshot/auto-follow-up.ts'
import { settingsFromProfile } from '../../domain/settings.ts'
import { emptyExtraction, type ExtractionResult } from '../../domain/screenshot/extraction.ts'

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
    const [
      profile,
      customers,
      contactMethods,
      vehicleInterests,
      activities,
      followUps,
      auditEntries,
      screenshots,
      extractionFields,
      matchCandidates,
      notifications,
      clarificationSessions,
      usageEvents,
      voiceRecords,
    ] = await Promise.all([
      this.loadProfile(),
      this.selectAll('customers', 'updated_at'),
      this.selectAll('customer_contact_methods', 'created_at'),
      this.selectAll('vehicle_interests', 'created_at'),
      this.selectAll('activities', 'occurred_at', ACTIVITY_FETCH_LIMIT),
      this.selectAll('follow_ups', 'due_at'),
      this.selectAll('audit_log', 'created_at', 500),
      this.selectAll('screenshots', 'created_at', 200),
      this.selectAll('screenshot_extraction_fields', 'created_at', 1000),
      this.selectAll('customer_match_candidates', 'created_at', 500),
      this.selectAll('notification_log', 'created_at', 500),
      this.selectAll('clarification_sessions', 'created_at', 50),
      this.selectAll('usage_events', 'occurred_at', 2000),
      this.selectAll('voice_processing_records', 'created_at', 500),
    ])

    return {
      profile,
      customers: customers.map(toCustomer),
      contactMethods: contactMethods.map(toContactMethod),
      vehicleInterests: vehicleInterests.map(toVehicleInterest),
      activities: activities.map(toActivity),
      followUps: followUps.map(toFollowUp),
      auditEntries: auditEntries.map(toAuditEntry),
      screenshots: screenshots.map(toScreenshot),
      extractionFields: extractionFields.map(toExtractionField),
      matchCandidates: matchCandidates.map(toStoredMatchCandidate),
      notifications: notifications.map(toNotification),
      clarificationSessions: clarificationSessions.map(toClarificationSession),
      usageEvents: usageEvents.map(toUsageEvent),
      voiceRecords: voiceRecords.map(toVoiceRecord),
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

          auto_import_enabled: patch.autoImportEnabled,
          auto_follow_up_on_import: patch.autoFollowUpOnImport,
          new_lead_same_day_cutoff_hour: patch.newLeadSameDayCutoffHour,
          same_day_follow_up_delay_hours: patch.sameDayFollowUpDelayHours,

          reminders_enabled: patch.remindersEnabled,
          individual_reminders_enabled: patch.individualRemindersEnabled,
          digest_only: patch.digestOnly,
          morning_digest_enabled: patch.morningDigestEnabled,
          end_of_day_digest_enabled: patch.endOfDayDigestEnabled,
          end_of_day_digest_at: patch.endOfDayDigestAt,
          appointment_reminder_lead_hours: patch.appointmentReminderLeadHours,
          overdue_reminder_interval_hours: patch.overdueReminderIntervalHours,
          reminder_max_attempts: patch.reminderMaxAttempts,

          annual_cost_threshold_usd: patch.annualCostThresholdUsd,
          voice_messages_per_day: patch.voiceMessagesPerDay,
          transcription_confidence_threshold: patch.transcriptionConfidenceThreshold,
          failed_audio_retention_hours: patch.failedAudioRetentionHours,
          retain_failed_transcripts: patch.retainFailedTranscripts,
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
  // Screenshot intake
  // -------------------------------------------------------------------------

  async findScreenshotByHash(
    fileHash: string,
  ): Promise<{ id: string; decision: ImportDecision | null } | null> {
    const { data, error } = await this.client
      .from('screenshots')
      .select('id, decision')
      .eq('file_hash', fileHash)
      .maybeSingle()

    unwrap(error, 'Could not check for a duplicate screenshot')
    if (data === null) return null

    const row = data as { id: string; decision: string | null }
    return { id: row.id, decision: (row.decision as ImportDecision | null) ?? null }
  }

  async applyScreenshotImport(input: ApplyImportInput): Promise<ImportOutcome> {
    const now = input.now ?? new Date()
    const screenshotId = await this.insertScreenshot(input, now)

    await this.storeExtractionFields(screenshotId, input)
    await this.storeMatchCandidates(screenshotId, input)

    if (!isAutomatic(input.decision)) {
      await this.setScreenshotStatus(
        screenshotId,
        input.decision === 'DUPLICATE_IGNORED' ? 'discarded' : 'needs_review',
      )
      await this.writeAudit('insert', 'screenshots', screenshotId, `Screenshot: ${input.decision}`, {
        decision: input.decision,
        reason: input.decisionReason,
      })

      return {
        screenshotId,
        decision: input.decision,
        reason: input.decisionReason,
        customerId: null,
        customerName: null,
        changes: [],
        followUpDueAt: null,
        requiresReview: input.decision !== 'DUPLICATE_IGNORED',
        undoable: false,
      }
    }

    return this.applyAutomatic(screenshotId, input, now)
  }

  async resolveScreenshotReview(input: ResolveReviewInput): Promise<ImportOutcome> {
    const now = input.now ?? new Date()

    const { data, error } = await this.client
      .from('screenshots')
      .select('*')
      .eq('id', input.screenshotId)
      .single()
    unwrap(error, 'Could not load the screenshot')

    const screenshot = toScreenshot(data as Record<string, unknown>)

    if (input.action.kind === 'discard') {
      await this.discardScreenshot(input.screenshotId, 'Discarded during review')
      return {
        screenshotId: input.screenshotId,
        decision: 'EXTRACTION_FAILED',
        reason: 'Discarded during review',
        customerId: null,
        customerName: null,
        changes: [{ label: 'Screenshot discarded' }],
        followUpDueAt: null,
        requiresReview: false,
        undoable: false,
      }
    }

    const { data: fieldRows, error: fieldError } = await this.client
      .from('screenshot_extraction_fields')
      .select('*')
      .eq('screenshot_id', input.screenshotId)
    unwrap(fieldError, 'Could not load the extracted fields')

    const stored = extractionFromFields(
      (fieldRows ?? []).map((row) => toExtractionField(row as Record<string, unknown>)),
    )
    const extraction = applyCorrections(stored, input.corrections ?? {})

    const targetId =
      input.action.kind === 'create_new' ? null : (input.action as { customerId: string }).customerId

    if (input.action.kind === 'keep_existing_fields') {
      await this.client
        .from('screenshots')
        .update({
          status: 'applied',
          customer_id: targetId,
          review_resolved_at: now.toISOString(),
          review_action: 'keep_existing_fields',
          raw_text: null,
        })
        .eq('id', input.screenshotId)

      await this.writeAudit('update', 'screenshots', input.screenshotId, 'Review kept existing fields', {
        action: 'keep_existing_fields',
      })

      return {
        screenshotId: input.screenshotId,
        decision: 'AUTO_UPDATE',
        reason: 'Existing values kept',
        customerId: targetId,
        customerName: null,
        changes: [{ label: 'No fields changed' }],
        followUpDueAt: null,
        requiresReview: false,
        undoable: false,
      }
    }

    const decision: ImportDecision =
      input.action.kind === 'create_new'
        ? 'AUTO_CREATE'
        : input.action.kind === 'select_existing_unverified'
          ? 'SAVE_WITH_UNVERIFIED_FIELDS'
          : 'AUTO_UPDATE'

    const outcome = await this.applyAutomatic(
      input.screenshotId,
      {
        screenshot: {
          fileHash: screenshot.fileHash,
          mimeType: screenshot.mimeType,
          byteSize: screenshot.byteSize,
          imageWidth: screenshot.imageWidth,
          imageHeight: screenshot.imageHeight,
          originalFilename: screenshot.originalFilename,
        },
        rawText: screenshot.rawText,
        extractionProvider: screenshot.extractionProvider ?? 'review',
        extraction,
        decision,
        decisionReason: 'Resolved in review',
        targetCustomerId: targetId,
        candidates: [],
        unverifiedFields: input.action.kind === 'select_existing_unverified' ? ['review_unverified'] : [],
        warnings: [],
        retainImage: screenshot.retained,
        now,
      },
      now,
      input.ignoredFields,
    )

    await this.client
      .from('screenshots')
      .update({ review_resolved_at: now.toISOString(), review_action: input.action.kind })
      .eq('id', input.screenshotId)

    return outcome
  }

  async discardScreenshot(screenshotId: string, reason?: string | null): Promise<void> {
    const { error } = await this.client
      .from('screenshots')
      .update({
        status: 'discarded',
        raw_text: null,
        review_resolved_at: new Date().toISOString(),
        review_action: 'discard',
      })
      .eq('id', screenshotId)

    unwrap(error, 'Could not discard the screenshot')
    await this.writeAudit('delete', 'screenshots', screenshotId, reason ?? 'Screenshot discarded', {})
  }

  async recordUsage(kind: UsageEventKind, quantity = 1, estimatedCostUsd = 0): Promise<void> {
    const { error } = await this.client.from('usage_events').insert({
      user_id: this.userId,
      kind,
      quantity,
      estimated_cost_usd: estimatedCostUsd,
    })

    unwrap(error, 'Could not record usage')
  }

  async deleteRetainedAudio(voiceRecordId: string): Promise<void> {
    const { error } = await this.client
      .from('voice_processing_records')
      .delete()
      .eq('id', voiceRecordId)
    unwrap(error, 'Could not delete retained audio metadata')
  }

  async cleanupPrivateData(before: Date): Promise<number> {
    const { data, error } = await this.client.rpc('delete_old_private_diagnostics', {
      p_before: before.toISOString(),
      p_delete_transcripts: true,
    })
    unwrap(error, 'Could not clean old private diagnostics')
    return typeof data === 'number' ? data : 0
  }

  async deleteAllUserData(): Promise<void> {
    const { error } = await this.client.rpc('delete_all_user_data')
    unwrap(error, 'Could not delete all application data')
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Executes an automatic import using the existing repository primitives, so
   * the writes go through the same RLS-checked paths a manual edit uses.
   */
  private async applyAutomatic(
    screenshotId: string,
    input: ApplyImportInput,
    now: Date,
    ignoredFields?: readonly string[],
  ): Promise<ImportOutcome> {
    const extraction = input.extraction
    if (extraction === null) throw new Error('Nothing was extracted from this screenshot.')

    const snapshot = await this.load()
    const existing =
      input.targetCustomerId === null
        ? null
        : (snapshot.customers.find((item) => item.id === input.targetCustomerId) ?? null)

    const plan = buildImportPlan({
      decision: input.decision,
      extraction,
      existing,
      existingContactMethods: snapshot.contactMethods.filter(
        (item) => item.customerId === existing?.id,
      ),
      existingVehicles: snapshot.vehicleInterests.filter((item) => item.customerId === existing?.id),
      ignoredFields,
    })

    let customerId = existing?.id ?? null
    let customerName = existing?.fullName ?? null

    if (plan.createDraft !== null) {
      customerId = await this.createCustomer({ ...plan.createDraft, leadStatus: plan.createDraft.leadStatus })
      customerName = plan.createDraft.fullName
      await this.client.from('customers').update({ source: 'screenshot' }).eq('id', customerId)
    } else if (customerId !== null && plan.updatePatch !== null && Object.keys(plan.updatePatch).length > 0) {
      await this.updateCustomer(customerId, plan.updatePatch)
    }

    if (customerId === null) throw new Error('The import produced no customer.')

    for (const method of plan.contactMethods) {
      try {
        await this.addContactMethod(customerId, {
          method: method.method,
          value: method.value,
          label: 'From a screenshot',
          isVerified: method.verified,
        })
      } catch {
        // A channel already on file is not an error; the unique index simply
        // refused a duplicate, which is the desired outcome.
      }
    }

    if (plan.vehicle !== null) {
      await this.saveVehicleInterest(customerId, {
        modelYear: plan.vehicle.modelYear,
        make: plan.vehicle.make,
        model: plan.vehicle.model,
        floorplan: plan.vehicle.floorplan,
        stockNumber: plan.vehicle.stockNumber,
        condition: plan.vehicle.condition,
        isPrimary: plan.vehicle.isPrimary,
      })
    }

    for (const activity of plan.activities) {
      await this.logActivity({
        customerId,
        type: activity.type,
        direction: activity.direction,
        summary: activity.summary,
        occurredAt: activity.occurredAt ?? now.toISOString(),
        source: 'screenshot',
        // Screenshot-visible activity is never a personal attempt.
        performedByUser: false,
      })
    }

    await this.logActivity({
      customerId,
      type: 'screenshot_import',
      direction: 'internal',
      summary: `Imported from a screenshot (${input.decision})`,
      source: 'screenshot',
      performedByUser: false,
    })

    const settings = settingsFromProfile(snapshot.profile)
    const followUpPlan = planAutoFollowUp(
      { leadStatus: existing?.leadStatus ?? plan.createDraft?.leadStatus ?? 'new' },
      snapshot.followUps.filter((item) => item.customerId === customerId),
      settings,
      { isNewCustomer: existing === null, now },
    )

    let followUpDueAt: string | null = null

    if (followUpPlan.dueAt !== null) {
      await this.scheduleFollowUp({
        customerId,
        dueAt: followUpPlan.dueAt.toISOString(),
        reason: followUpPlan.description,
        priority: settings.defaultLeadPriority,
        resolution: 'reschedule',
      })
      followUpDueAt = followUpPlan.dueAt.toISOString()
      plan.changes.push('Follow-up scheduled')
    } else if (followUpPlan.reason === 'kept_existing') {
      plan.changes.push('Existing follow-up kept')
    }

    await this.client
      .from('screenshots')
      .update({
        status: 'applied',
        customer_id: customerId,
        applied_at: now.toISOString(),
        // Discarded after a successful extraction unless retention is on.
        raw_text: input.retainImage ? input.rawText : null,
      })
      .eq('id', screenshotId)

    await this.writeAudit(
      existing === null ? 'insert' : 'update',
      'customers',
      customerId,
      `Screenshot import: ${input.decision}`,
      {
        decision: input.decision,
        reason: input.decisionReason,
        screenshotId,
        unverifiedFields: [...input.unverifiedFields],
      },
    )

    return {
      screenshotId,
      decision: input.decision,
      reason: input.decisionReason,
      customerId,
      customerName,
      changes: plan.changes.map((label) => ({ label })),
      followUpDueAt,
      requiresReview: false,
      undoable: existing === null,
    }
  }

  private async insertScreenshot(input: ApplyImportInput, now: Date): Promise<string> {
    const { data, error } = await this.client
      .from('screenshots')
      .insert({
        user_id: this.userId,
        file_hash: input.screenshot.fileHash,
        mime_type: input.screenshot.mimeType,
        byte_size: input.screenshot.byteSize,
        image_width: input.screenshot.imageWidth,
        image_height: input.screenshot.imageHeight,
        original_filename: input.screenshot.originalFilename,
        status: 'extracting',
        extraction_provider: input.extractionProvider,
        raw_text: input.rawText,
        captured_at: input.screenshot.capturedAt ?? now.toISOString(),
        decision: input.decision,
        decision_reason: input.decisionReason.slice(0, 300),
        overall_confidence: input.extraction?.overallConfidence ?? null,
        warnings: [...input.warnings],
        contains_multiple_customers: input.extraction?.containsMultipleCustomers ?? false,
        retained: input.retainImage,
      })
      .select('id')
      .single()

    unwrap(error, 'Could not record the screenshot')
    return (data as { id: string }).id
  }

  private async setScreenshotStatus(screenshotId: string, status: string): Promise<void> {
    const { error } = await this.client.from('screenshots').update({ status }).eq('id', screenshotId)
    unwrap(error, 'Could not update the screenshot')
  }

  private async storeExtractionFields(screenshotId: string, input: ApplyImportInput): Promise<void> {
    const extraction = input.extraction
    if (extraction === null) return

    const unverified = new Set(input.unverifiedFields)
    const rows = extractionFieldRows(extraction).map((field) => ({
      user_id: this.userId,
      screenshot_id: screenshotId,
      field_key: field.key,
      field_value: field.value,
      confidence: field.confidence,
      verified: !unverified.has(field.key) && field.confidence >= 0.75,
      applied_as_unverified: unverified.has(field.key),
    }))

    if (rows.length === 0) return

    const { error } = await this.client.from('screenshot_extraction_fields').insert(rows)
    unwrap(error, 'Could not store the extracted fields')
  }

  private async storeMatchCandidates(screenshotId: string, input: ApplyImportInput): Promise<void> {
    if (input.candidates.length === 0) return

    const rows = input.candidates.map((candidate) => ({
      user_id: this.userId,
      customer_id: candidate.customer.id,
      screenshot_id: screenshotId,
      score: candidate.score,
      match_signals: { reasons: candidate.reasons, conflicts: candidate.conflicts },
      selected: candidate.customer.id === input.targetCustomerId,
    }))

    const { error } = await this.client.from('customer_match_candidates').insert(rows)
    unwrap(error, 'Could not store the match candidates')
  }

  private async writeAudit(
    action: string,
    tableName: string,
    recordId: string | null,
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client.from('audit_log').insert({
      user_id: this.userId,
      action,
      table_name: tableName,
      record_id: recordId,
      summary: summary.slice(0, 500),
      metadata,
      source: 'screenshot',
    })

    unwrap(error, 'Could not write the audit entry')
  }

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

/** The extraction fields worth persisting, with the confidence each was read at. */
function extractionFieldRows(
  extraction: ExtractionResult,
): Array<{ key: string; value: string; confidence: number }> {
  const entries: Array<[string, string | null, number]> = [
    ['full_name', extraction.customer.fullName, 0.9],
    ['primary_phone', extraction.customer.phone, 0.85],
    ['primary_email', extraction.customer.email, 0.85],
    ['dealership_customer_id', extraction.customer.customerId, 0.95],
    ['city', extraction.customer.city, 0.8],
    ['state', extraction.customer.state, 0.8],
    ['lead_source', extraction.leadSource, 0.7],
    ['salesperson', extraction.salesperson, 0.7],
    ['vehicle_make', extraction.vehicleInterest.make, 0.75],
    ['vehicle_model', extraction.vehicleInterest.model, 0.75],
    ['vehicle_floorplan', extraction.vehicleInterest.floorplan, 0.7],
    ['vehicle_stock_number', extraction.vehicleInterest.stockNumber, 0.85],
  ]

  return entries
    .filter((entry): entry is [string, string, number] => entry[1] !== null)
    .map(([key, value, confidence]) => ({ key, value, confidence }))
}

/** Rebuilds an extraction from stored fields so review can replay the planner. */
function extractionFromFields(fields: readonly ScreenshotExtractionField[]): ExtractionResult {
  const extraction = emptyExtraction()

  for (const field of fields) {
    switch (field.fieldKey) {
      case 'full_name':
        extraction.customer.fullName = field.fieldValue
        break
      case 'primary_phone':
        extraction.customer.phone = field.fieldValue
        break
      case 'primary_email':
        extraction.customer.email = field.fieldValue
        break
      case 'dealership_customer_id':
        extraction.customer.customerId = field.fieldValue
        break
      case 'city':
        extraction.customer.city = field.fieldValue
        break
      case 'state':
        extraction.customer.state = field.fieldValue
        break
      case 'lead_source':
        extraction.leadSource = field.fieldValue
        break
      case 'salesperson':
        extraction.salesperson = field.fieldValue
        break
      case 'vehicle_make':
        extraction.vehicleInterest.make = field.fieldValue
        break
      case 'vehicle_model':
        extraction.vehicleInterest.model = field.fieldValue
        break
      case 'vehicle_floorplan':
        extraction.vehicleInterest.floorplan = field.fieldValue
        break
      case 'vehicle_stock_number':
        extraction.vehicleInterest.stockNumber = field.fieldValue
        break
      default:
        break
    }
  }

  if (extraction.customer.phone !== null) {
    extraction.availableContactMethods.push(
      { method: 'phone_call', available: true, value: extraction.customer.phone, confidence: 0.9 },
      { method: 'sms', available: true, value: extraction.customer.phone, confidence: 0.8 },
    )
  }
  if (extraction.customer.email !== null) {
    extraction.availableContactMethods.push({
      method: 'email',
      available: true,
      value: extraction.customer.email,
      confidence: 0.9,
    })
  }

  extraction.overallConfidence = 0.9
  return extraction
}
