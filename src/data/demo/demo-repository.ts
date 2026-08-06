/**
 * Demo-mode repository.
 *
 * Backed by browser-local storage, and deliberately enforcing the same
 * invariants the database does — one open follow-up per customer, activities
 * that are never deletable, audit entries on correction, and
 * `performedByUser` set only when a caller says so. If demo mode were more
 * permissive than Supabase, rehearsing a workflow here would teach the wrong
 * thing.
 *
 * Every operation reads the snapshot, mutates it and writes it back, so there
 * is no cached state to go stale between calls.
 */

import type {
  Activity,
  AuditEntry,
  Customer,
  CustomerContactMethod,
  FollowUp,
  VehicleInterest,
} from '../../domain/models.ts'
import { normalizeEmail, normalizeName, normalizePhone } from '../../lib/normalize.ts'
import { isClosedLeadStatus, isOpenFollowUpStatus } from '../../domain/vocabulary.ts'
import type { LeadStatus } from '../../domain/vocabulary.ts'
import type { UserSettings } from '../../domain/settings.ts'
import type {
  ActivityDraft,
  ActivityPatch,
  ApplyImportInput,
  ContactMethodDraft,
  CustomerDraft,
  CustomerPatch,
  FollowUpPlan,
  FollowUpResolution,
  ImportOutcome,
  Repository,
  ResolveReviewInput,
  ScheduleFollowUpInput,
  SimulatedDispatch,
  SimulatedInbound,
  VehicleInterestDraft,
  WorkspaceSnapshot,
} from '../workspace.ts'
import { clearSnapshot, newId, readSnapshot, writeSnapshot } from './storage.ts'
import type { Profile, UsageEventKind } from '../../domain/models.ts'
import type { ImportDecision } from '../../domain/screenshot/decision-engine.ts'
import { applyCorrections } from '../../domain/screenshot/import-plan.ts'
import {
  applyImport,
  pushAudit,
  readStoredExtraction,
  runSimulatedInbound,
  runSimulatedReminders,
} from './import-runtime.ts'

export class DemoRepository implements Repository {
  readonly mode = 'demo' as const

  async load(): Promise<WorkspaceSnapshot> {
    return readSnapshot()
  }

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------

  async createCustomer(draft: CustomerDraft): Promise<string> {
    return this.mutate((snapshot) => {
      const now = new Date().toISOString()
      const id = newId()
      const status = draft.leadStatus ?? 'new'

      const customer: Customer = {
        id,
        userId: snapshot.profile.id,
        fullName: draft.fullName.trim(),
        firstName: nullableText(draft.firstName),
        lastName: nullableText(draft.lastName),
        normalizedName: normalizeName(draft.fullName),
        primaryPhone: nullableText(draft.primaryPhone),
        normalizedPhone: normalizePhone(draft.primaryPhone),
        primaryEmail: nullableText(draft.primaryEmail),
        normalizedEmail: normalizeEmail(draft.primaryEmail),
        dealershipCustomerId: nullableText(draft.dealershipCustomerId),
        city: nullableText(draft.city),
        state: nullableText(draft.state)?.toUpperCase() ?? null,
        preferredLanguage: draft.preferredLanguage ?? 'unknown',
        salesperson: nullableText(draft.salesperson),
        leadSource: nullableText(draft.leadSource),
        leadPriority: draft.leadPriority ?? 'normal',
        leadTemperature: draft.leadTemperature ?? 'unknown',
        leadStatus: status,
        preferredContactMethod: draft.preferredContactMethod ?? null,
        notes: nullableText(draft.notes),
        pinnedNote: nullableText(draft.pinnedNote),
        objections: nullableText(draft.objections),
        tradeNotes: nullableText(draft.tradeNotes),
        financeStatus: nullableText(draft.financeStatus),
        source: 'manual',
        lastActivityAt: null,
        // Mirrors the customers_archived_consistency check constraint.
        archivedAt: status === 'archived' ? now : null,
        createdAt: now,
        updatedAt: now,
      }

      snapshot.customers.push(customer)

      // A phone or email typed on the create form is also a usable channel, so
      // it becomes a contact method rather than sitting only on the customer.
      if (customer.primaryPhone !== null) {
        pushContactMethod(snapshot, customer, 'phone_call', customer.primaryPhone)
        pushContactMethod(snapshot, customer, 'sms', customer.primaryPhone)
      }
      if (customer.primaryEmail !== null) {
        pushContactMethod(snapshot, customer, 'email', customer.primaryEmail)
      }

      return id
    })
  }

  async updateCustomer(customerId: string, patch: CustomerPatch): Promise<void> {
    await this.mutate((snapshot) => {
      const customer = requireCustomer(snapshot, customerId)

      Object.assign(customer, {
        ...(patch.fullName === undefined
          ? {}
          : { fullName: patch.fullName.trim(), normalizedName: normalizeName(patch.fullName) }),
        ...(patch.firstName === undefined ? {} : { firstName: nullableText(patch.firstName) }),
        ...(patch.lastName === undefined ? {} : { lastName: nullableText(patch.lastName) }),
        ...(patch.primaryPhone === undefined
          ? {}
          : {
              primaryPhone: nullableText(patch.primaryPhone),
              normalizedPhone: normalizePhone(patch.primaryPhone),
            }),
        ...(patch.primaryEmail === undefined
          ? {}
          : {
              primaryEmail: nullableText(patch.primaryEmail),
              normalizedEmail: normalizeEmail(patch.primaryEmail),
            }),
        ...(patch.dealershipCustomerId === undefined
          ? {}
          : { dealershipCustomerId: nullableText(patch.dealershipCustomerId) }),
        ...(patch.city === undefined ? {} : { city: nullableText(patch.city) }),
        ...(patch.state === undefined
          ? {}
          : { state: nullableText(patch.state)?.toUpperCase() ?? null }),
        ...(patch.preferredLanguage === undefined ? {} : { preferredLanguage: patch.preferredLanguage }),
        ...(patch.preferredContactMethod === undefined
          ? {}
          : { preferredContactMethod: patch.preferredContactMethod }),
        ...(patch.salesperson === undefined ? {} : { salesperson: nullableText(patch.salesperson) }),
        ...(patch.leadSource === undefined ? {} : { leadSource: nullableText(patch.leadSource) }),
        ...(patch.leadPriority === undefined ? {} : { leadPriority: patch.leadPriority }),
        ...(patch.leadTemperature === undefined ? {} : { leadTemperature: patch.leadTemperature }),
        ...(patch.notes === undefined ? {} : { notes: nullableText(patch.notes) }),
        ...(patch.pinnedNote === undefined ? {} : { pinnedNote: nullableText(patch.pinnedNote) }),
        ...(patch.objections === undefined ? {} : { objections: nullableText(patch.objections) }),
        ...(patch.tradeNotes === undefined ? {} : { tradeNotes: nullableText(patch.tradeNotes) }),
        ...(patch.financeStatus === undefined ? {} : { financeStatus: nullableText(patch.financeStatus) }),
        updatedAt: new Date().toISOString(),
      })

      // Status moves go through setLeadStatus so the side effects always run.
      if (patch.leadStatus !== undefined && patch.leadStatus !== customer.leadStatus) {
        applyLeadStatus(snapshot, customer, patch.leadStatus, null)
      }
    })
  }

  async setLeadStatus(customerId: string, status: LeadStatus, note?: string | null): Promise<void> {
    await this.mutate((snapshot) => {
      applyLeadStatus(snapshot, requireCustomer(snapshot, customerId), status, note ?? null)
    })
  }

  async archiveCustomer(customerId: string): Promise<void> {
    await this.setLeadStatus(customerId, 'archived', 'Archived')
  }

  async restoreCustomer(customerId: string, status: LeadStatus): Promise<void> {
    await this.mutate((snapshot) => {
      const customer = requireCustomer(snapshot, customerId)
      customer.archivedAt = null
      applyLeadStatus(snapshot, customer, status, 'Restored from archive')
    })
  }

  async deleteCustomer(customerId: string): Promise<void> {
    await this.mutate((snapshot) => {
      // Children cascade, mirroring the ON DELETE CASCADE foreign keys.
      snapshot.customers = snapshot.customers.filter((item) => item.id !== customerId)
      snapshot.contactMethods = snapshot.contactMethods.filter((item) => item.customerId !== customerId)
      snapshot.vehicleInterests = snapshot.vehicleInterests.filter(
        (item) => item.customerId !== customerId,
      )
      snapshot.activities = snapshot.activities.filter((item) => item.customerId !== customerId)
      snapshot.followUps = snapshot.followUps.filter((item) => item.customerId !== customerId)
    })
  }

  // -------------------------------------------------------------------------
  // Contact methods and vehicle interests
  // -------------------------------------------------------------------------

  async addContactMethod(customerId: string, draft: ContactMethodDraft): Promise<void> {
    await this.mutate((snapshot) => {
      const customer = requireCustomer(snapshot, customerId)
      const normalized = normalizeContactValue(draft.method, draft.value)

      // Matches the unique index on (customer_id, method, normalized_value).
      const duplicate = snapshot.contactMethods.some(
        (item) =>
          item.customerId === customerId &&
          item.method === draft.method &&
          normalizeContactValue(item.method, item.value) === normalized,
      )
      if (duplicate) throw new Error('That contact method is already on file for this customer.')

      pushContactMethod(snapshot, customer, draft.method, draft.value, draft)
    })
  }

  async updateContactMethod(
    contactMethodId: string,
    patch: Partial<ContactMethodDraft>,
  ): Promise<void> {
    await this.mutate((snapshot) => {
      const method = snapshot.contactMethods.find((item) => item.id === contactMethodId)
      if (method === undefined) throw new Error('Contact method not found.')

      if (patch.isPrimary === true) clearPrimaryMethods(snapshot, method.customerId, method.method)
      Object.assign(method, stripUndefined(patch))
    })
  }

  async removeContactMethod(contactMethodId: string): Promise<void> {
    await this.mutate((snapshot) => {
      snapshot.contactMethods = snapshot.contactMethods.filter((item) => item.id !== contactMethodId)
    })
  }

  async saveVehicleInterest(
    customerId: string,
    draft: VehicleInterestDraft,
    vehicleInterestId?: string,
  ): Promise<void> {
    await this.mutate((snapshot) => {
      requireCustomer(snapshot, customerId)

      if (draft.isPrimary === true) {
        for (const item of snapshot.vehicleInterests) {
          if (item.customerId === customerId) item.isPrimary = false
        }
      }

      if (vehicleInterestId !== undefined) {
        const existing = snapshot.vehicleInterests.find((item) => item.id === vehicleInterestId)
        if (existing === undefined) throw new Error('Vehicle interest not found.')
        Object.assign(existing, stripUndefined(draft))
        return
      }

      const vehicle: VehicleInterest = {
        id: newId(),
        customerId,
        modelYear: draft.modelYear ?? null,
        make: nullableText(draft.make),
        model: nullableText(draft.model),
        floorplan: nullableText(draft.floorplan),
        stockNumber: nullableText(draft.stockNumber),
        condition: draft.condition ?? 'unknown',
        isPrimary: draft.isPrimary ?? false,
        notes: nullableText(draft.notes),
      }

      snapshot.vehicleInterests.push(vehicle)
    })
  }

  async removeVehicleInterest(vehicleInterestId: string): Promise<void> {
    await this.mutate((snapshot) => {
      snapshot.vehicleInterests = snapshot.vehicleInterests.filter(
        (item) => item.id !== vehicleInterestId,
      )
    })
  }

  // -------------------------------------------------------------------------
  // Activities
  // -------------------------------------------------------------------------

  async logActivity(draft: ActivityDraft, plan: FollowUpPlan = { kind: 'none' }): Promise<void> {
    await this.mutate((snapshot) => {
      const customer = requireCustomer(snapshot, draft.customerId)
      const occurredAt = draft.occurredAt ?? new Date().toISOString()

      const activity: Activity = {
        id: newId(),
        customerId: draft.customerId,
        type: draft.type,
        direction: draft.direction,
        method: draft.method ?? null,
        outcome: draft.outcome ?? null,
        summary: nullableText(draft.summary),
        rawText: null,
        occurredAt,
        source: draft.source ?? 'manual',
        // An internal activity can never be a personal attempt, matching the
        // activities_internal_not_user_attempt check constraint.
        performedByUser: draft.direction === 'internal' ? false : draft.performedByUser,
        externalMessageId: null,
      }

      snapshot.activities.push(activity)

      if (customer.lastActivityAt === null || occurredAt > customer.lastActivityAt) {
        customer.lastActivityAt = occurredAt
      }
      customer.updatedAt = new Date().toISOString()

      // A customer who replied is no longer someone to wait on. The follow-up
      // becomes due now so the next decision is asked for rather than deferred.
      if (draft.direction === 'inbound') {
        clearWaiting(snapshot, customer.id, new Date(occurredAt))
      }

      applyPlan(snapshot, customer, plan)
    })
  }

  async updateActivity(
    activityId: string,
    patch: ActivityPatch,
    reason?: string | null,
  ): Promise<void> {
    await this.mutate((snapshot) => {
      const activity = snapshot.activities.find((item) => item.id === activityId)
      if (activity === undefined) throw new Error('Activity not found.')

      const before = snapshotOfActivity(activity)
      Object.assign(activity, stripUndefined(patch))
      if (activity.direction === 'internal') activity.performedByUser = false
      const after = snapshotOfActivity(activity)

      // Corrections are recorded rather than applied silently, so the timeline
      // can show that a row was edited and what it used to say.
      const entry: AuditEntry = {
        id: newId(),
        action: 'update',
        tableName: 'activities',
        recordId: activityId,
        summary: 'Activity corrected',
        metadata: { before, after, reason: reason ?? null },
        createdAt: new Date().toISOString(),
      }

      snapshot.auditEntries.push(entry)
    })
  }

  // -------------------------------------------------------------------------
  // Follow-ups
  // -------------------------------------------------------------------------

  async scheduleFollowUp(input: ScheduleFollowUpInput): Promise<void> {
    await this.mutate((snapshot) => {
      const customer = requireCustomer(snapshot, input.customerId)

      insertFollowUp(snapshot, customer, {
        dueAt: input.dueAt,
        reason: input.reason ?? null,
        recommendedMethod: input.recommendedMethod ?? null,
        priority: input.priority ?? customer.leadPriority,
        waitingUntil: input.waitingUntil ?? null,
        isAppointment: input.isAppointment ?? false,
        resolution: input.resolution ?? 'reschedule',
        resolutionNote: input.resolutionNote ?? null,
      })
    })
  }

  async completeFollowUp(customerId: string, note?: string | null): Promise<void> {
    await this.mutate((snapshot) => {
      const closed = closeOpenFollowUp(snapshot, customerId, 'complete', note ?? null)
      if (closed !== null) {
        recordInternalActivity(snapshot, customerId, 'follow_up_completed', 'Follow-up completed')
      }
    })
  }

  async cancelFollowUp(customerId: string, note?: string | null): Promise<void> {
    await this.mutate((snapshot) => {
      closeOpenFollowUp(snapshot, customerId, 'cancel', note ?? null)
    })
  }

  async snoozeFollowUp(followUpId: string, snoozedUntil: string): Promise<void> {
    await this.mutate((snapshot) => {
      const followUp = snapshot.followUps.find((item) => item.id === followUpId)
      if (followUp === undefined) throw new Error('Follow-up not found.')
      if (!isOpenFollowUpStatus(followUp.status)) throw new Error('That follow-up is already closed.')

      followUp.status = 'snoozed'
      followUp.snoozedUntil = snoozedUntil
      // Waiting and snoozing are different states; leaving both set would make
      // the effective due time ambiguous.
      followUp.waitingUntil = null
    })
  }

  async expireWaitingFollowUps(now: Date = new Date()): Promise<number> {
    return this.mutate((snapshot) => {
      let expired = 0

      for (const followUp of snapshot.followUps) {
        if (followUp.status !== 'waiting_on_customer') continue
        if (followUp.waitingUntil === null) continue
        if (new Date(followUp.waitingUntil).getTime() > now.getTime()) continue

        followUp.status = 'overdue'
        // The deadline is when action became due, not when it was noticed.
        followUp.dueAt =
          followUp.waitingUntil < followUp.dueAt ? followUp.waitingUntil : followUp.dueAt
        followUp.waitingUntil = null
        followUp.outcomeNote ??= 'Waiting period elapsed with no response'
        expired += 1
      }

      return expired
    })
  }

  // -------------------------------------------------------------------------
  // Profile and settings
  // -------------------------------------------------------------------------

  async updateSettings(patch: Partial<UserSettings>): Promise<void> {
    await this.mutate((snapshot) => {
      Object.assign(snapshot.profile, stripUndefined(patch))
    })
  }

  async updateProfile(patch: Partial<Pick<Profile, 'displayName'>>): Promise<void> {
    await this.mutate((snapshot) => {
      Object.assign(snapshot.profile, stripUndefined(patch))
    })
  }

  // -------------------------------------------------------------------------
  // Screenshot intake
  // -------------------------------------------------------------------------

  async findScreenshotByHash(
    fileHash: string,
  ): Promise<{ id: string; decision: ImportDecision | null } | null> {
    const snapshot = readSnapshot()
    const existing = snapshot.screenshots.find((item) => item.fileHash === fileHash)

    return existing === undefined
      ? null
      : { id: existing.id, decision: (existing.decision as ImportDecision | null) ?? null }
  }

  async applyScreenshotImport(input: ApplyImportInput): Promise<ImportOutcome> {
    return this.mutate((snapshot) => applyImport(snapshot, input))
  }

  async resolveScreenshotReview(input: ResolveReviewInput): Promise<ImportOutcome> {
    return this.mutate((snapshot) => {
      const screenshot = snapshot.screenshots.find((item) => item.id === input.screenshotId)
      if (screenshot === undefined) throw new Error('Screenshot not found.')

      const now = input.now ?? new Date()

      if (input.action.kind === 'discard') {
        screenshot.status = 'discarded'
        screenshot.reviewResolvedAt = now.toISOString()
        screenshot.reviewAction = 'discard'
        screenshot.rawText = null
        pushAudit(snapshot, 'update', 'screenshots', screenshot.id, 'Screenshot discarded in review', {
          action: 'discard',
        })

        return {
          screenshotId: screenshot.id,
          decision: 'EXTRACTION_FAILED' as ImportDecision,
          reason: 'Discarded during review',
          customerId: null,
          customerName: null,
          changes: [{ label: 'Screenshot discarded' }],
          followUpDueAt: null,
          requiresReview: false,
          undoable: false,
        }
      }

      // The stored extraction is replayed with the operator's corrections, so
      // review reuses the same planner an automatic import used.
      const stored = readStoredExtraction(snapshot, screenshot.id)
      const corrected = applyCorrections(stored, input.corrections ?? {})

      const targetId =
        input.action.kind === 'create_new' ? null : (input.action as { customerId: string }).customerId

      const decision: ImportDecision =
        input.action.kind === 'create_new'
          ? 'AUTO_CREATE'
          : input.action.kind === 'select_existing_unverified'
            ? 'SAVE_WITH_UNVERIFIED_FIELDS'
            : 'AUTO_UPDATE'

      // "Keep existing fields" applies nothing but the link and closes the item.
      if (input.action.kind === 'keep_existing_fields') {
        screenshot.status = 'applied'
        screenshot.customerId = targetId
        screenshot.reviewResolvedAt = now.toISOString()
        screenshot.reviewAction = 'keep_existing_fields'
        screenshot.rawText = null
        pushAudit(snapshot, 'update', 'screenshots', screenshot.id, 'Review kept existing fields', {
          action: 'keep_existing_fields',
          customerId: targetId,
        })

        const customer = snapshot.customers.find((item) => item.id === targetId)
        return {
          screenshotId: screenshot.id,
          decision: 'AUTO_UPDATE' as ImportDecision,
          reason: 'Existing values kept',
          customerId: targetId,
          customerName: customer?.fullName ?? null,
          changes: [{ label: 'No fields changed' }],
          followUpDueAt: null,
          requiresReview: false,
          undoable: false,
        }
      }

      const outcome = applyImport(snapshot, {
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
        extraction: corrected,
        decision,
        decisionReason: 'Resolved in review',
        targetCustomerId: targetId,
        candidates: [],
        unverifiedFields: input.action.kind === 'select_existing_unverified' ? ['review_unverified'] : [],
        warnings: [],
        retainImage: false,
        now,
        ignoredFields: input.ignoredFields,
        existingScreenshotId: screenshot.id,
      })

      screenshot.reviewResolvedAt = now.toISOString()
      screenshot.reviewAction = input.action.kind

      return outcome
    })
  }

  async discardScreenshot(screenshotId: string, reason?: string | null): Promise<void> {
    await this.mutate((snapshot) => {
      const screenshot = snapshot.screenshots.find((item) => item.id === screenshotId)
      if (screenshot === undefined) return

      screenshot.status = 'discarded'
      screenshot.rawText = null
      screenshot.reviewResolvedAt = new Date().toISOString()
      screenshot.reviewAction = 'discard'
      pushAudit(snapshot, 'delete', 'screenshots', screenshotId, reason ?? 'Screenshot discarded', {})
    })
  }

  // -------------------------------------------------------------------------
  // Cost metering and simulation
  // -------------------------------------------------------------------------

  async recordUsage(kind: UsageEventKind, quantity = 1, estimatedCostUsd = 0): Promise<void> {
    await this.mutate((snapshot) => {
      snapshot.usageEvents.push({
        id: newId(),
        kind,
        quantity,
        estimatedCostUsd,
        occurredAt: new Date().toISOString(),
      })
    })
  }

  async simulateReminderRun(now: Date = new Date()): Promise<SimulatedDispatch> {
    // Reuses the real engine and the real idempotency check; only the transport
    // is simulated, so a duplicate here is a duplicate in production too.
    await this.expireWaitingFollowUps(now)

    return this.mutate((snapshot) => runSimulatedReminders(snapshot, now))
  }

  async simulateInboundMessage(
    fromE164: string,
    text: string,
    now: Date = new Date(),
  ): Promise<SimulatedInbound> {
    return this.mutate((snapshot) => runSimulatedInbound(snapshot, fromE164, text, now))
  }

  async resetDemoData(): Promise<void> {
    clearSnapshot()
  }

  /** Reads, applies, and writes back in one step so no caller forgets to save. */
  private mutate<T>(operation: (snapshot: WorkspaceSnapshot) => T): T {
    const snapshot = readSnapshot()
    const result = operation(snapshot)
    writeSnapshot(snapshot)
    return result
  }
}

// ---------------------------------------------------------------------------
// Shared mutation helpers
// ---------------------------------------------------------------------------

interface InsertFollowUpInput {
  dueAt: string
  reason: string | null
  recommendedMethod: FollowUp['recommendedMethod']
  priority: FollowUp['priority']
  waitingUntil: string | null
  isAppointment: boolean
  resolution: FollowUpResolution
  resolutionNote: string | null
}

/**
 * Closes any open follow-up and opens the next one, linking the two.
 *
 * Mirrors public.schedule_follow_up: the previous commitment is always
 * recorded as completed or canceled, never dropped, and only one open row can
 * exist at a time.
 */
function insertFollowUp(
  snapshot: WorkspaceSnapshot,
  customer: Customer,
  input: InsertFollowUpInput,
): FollowUp {
  const previousId = closeOpenFollowUp(
    snapshot,
    customer.id,
    input.resolution,
    input.resolutionNote,
  )

  const now = new Date().toISOString()
  const followUp: FollowUp = {
    id: newId(),
    customerId: customer.id,
    dueAt: input.dueAt,
    status: input.waitingUntil === null ? 'pending' : 'waiting_on_customer',
    priority: input.priority,
    reason: input.reason,
    recommendedMethod: input.recommendedMethod,
    waitingUntil: input.waitingUntil,
    completedAt: null,
    snoozedUntil: null,
    reminderStatus: 'not_scheduled',
    whatsappMessageId: null,
    isAppointment: input.isAppointment,
    canceledAt: null,
    outcomeNote: null,
    rescheduledFromId: previousId,
    createdAt: now,
  }

  snapshot.followUps.push(followUp)

  // Keep the lead status in step with the commitment that now exists, unless
  // the customer has already been closed out.
  if (!isClosedLeadStatus(customer.leadStatus)) {
    customer.leadStatus = input.waitingUntil !== null
      ? 'waiting_on_customer'
      : input.isAppointment
        ? 'appointment_scheduled'
        : 'follow_up_scheduled'
    customer.updatedAt = now
  }

  return followUp
}

function closeOpenFollowUp(
  snapshot: WorkspaceSnapshot,
  customerId: string,
  resolution: FollowUpResolution,
  note: string | null,
): string | null {
  const open = snapshot.followUps.find(
    (item) => item.customerId === customerId && isOpenFollowUpStatus(item.status),
  )
  if (open === undefined) return null

  const now = new Date().toISOString()
  const completing = resolution === 'complete'

  open.status = completing ? 'completed' : 'canceled'
  open.completedAt = completing ? now : null
  open.canceledAt = completing ? null : now
  // Snooze and waiting deadlines are meaningless once the row is closed.
  open.snoozedUntil = null
  open.waitingUntil = null
  open.outcomeNote = note ?? open.outcomeNote ?? resolutionNote(resolution)

  return open.id
}

function resolutionNote(resolution: FollowUpResolution): string {
  switch (resolution) {
    case 'complete':
      return 'Completed'
    case 'cancel':
      return 'Canceled'
    case 'reschedule':
      return 'Replaced by a rescheduled follow-up'
  }
}

function clearWaiting(snapshot: WorkspaceSnapshot, customerId: string, now: Date): void {
  const waiting = snapshot.followUps.find(
    (item) => item.customerId === customerId && item.status === 'waiting_on_customer',
  )
  if (waiting === undefined) return

  waiting.status = 'pending'
  waiting.dueAt = now.toISOString()
  waiting.waitingUntil = null
  waiting.outcomeNote ??= 'Customer responded'

  const customer = snapshot.customers.find((item) => item.id === customerId)
  if (customer !== undefined && customer.leadStatus === 'waiting_on_customer') {
    customer.leadStatus = 'follow_up_scheduled'
  }
}

function applyPlan(snapshot: WorkspaceSnapshot, customer: Customer, plan: FollowUpPlan): void {
  switch (plan.kind) {
    case 'none':
      return

    case 'complete':
      closeOpenFollowUp(snapshot, customer.id, 'complete', plan.note ?? null)
      // Completing without scheduling anything is legitimate, and the customer
      // correctly lands in the no-next-action queue as a result.
      if (!isClosedLeadStatus(customer.leadStatus)) customer.leadStatus = 'working'
      return

    case 'schedule':
      insertFollowUp(snapshot, customer, {
        dueAt: plan.dueAt,
        reason: plan.reason ?? null,
        recommendedMethod: plan.recommendedMethod ?? null,
        priority: plan.priority ?? customer.leadPriority,
        waitingUntil: null,
        isAppointment: plan.isAppointment ?? false,
        resolution: plan.resolution,
        resolutionNote: plan.resolutionNote ?? null,
      })
      return

    case 'waiting':
      insertFollowUp(snapshot, customer, {
        dueAt: plan.waitingUntil,
        reason: plan.reason ?? 'Waiting for the customer to respond',
        recommendedMethod: null,
        priority: customer.leadPriority,
        waitingUntil: plan.waitingUntil,
        isAppointment: false,
        resolution: plan.resolution,
        resolutionNote: plan.resolutionNote ?? null,
      })
      return

    case 'close':
      applyLeadStatus(snapshot, customer, plan.leadStatus, plan.note ?? null)
  }
}

function applyLeadStatus(
  snapshot: WorkspaceSnapshot,
  customer: Customer,
  status: LeadStatus,
  note: string | null,
): void {
  if (customer.leadStatus === status && status !== 'archived') return

  const now = new Date().toISOString()
  const previous = customer.leadStatus

  customer.leadStatus = status
  customer.archivedAt = status === 'archived' ? (customer.archivedAt ?? now) : null
  customer.updatedAt = now

  // A closed customer has no outstanding commitment, so the open follow-up is
  // canceled rather than left to surface in the overdue queue forever.
  if (isClosedLeadStatus(status)) {
    closeOpenFollowUp(snapshot, customer.id, 'cancel', note ?? `Customer marked ${status}`)
  }

  recordInternalActivity(
    snapshot,
    customer.id,
    'status_change',
    note ?? `Status changed from ${previous} to ${status}`,
  )
}

function recordInternalActivity(
  snapshot: WorkspaceSnapshot,
  customerId: string,
  type: Activity['type'],
  summary: string,
): void {
  snapshot.activities.push({
    id: newId(),
    customerId,
    type,
    direction: 'internal',
    method: null,
    outcome: null,
    summary,
    rawText: null,
    occurredAt: new Date().toISOString(),
    source: 'manual',
    // Internal rows are never personal contact attempts.
    performedByUser: false,
    externalMessageId: null,
  })
}

function pushContactMethod(
  snapshot: WorkspaceSnapshot,
  customer: Customer,
  method: CustomerContactMethod['method'],
  value: string,
  extra: Partial<ContactMethodDraft> = {},
): void {
  const isPrimary = extra.isPrimary ?? true
  if (isPrimary) clearPrimaryMethods(snapshot, customer.id, method)

  snapshot.contactMethods.push({
    id: newId(),
    customerId: customer.id,
    method,
    value: value.trim(),
    label: nullableText(extra.label),
    isPrimary,
    isVerified: extra.isVerified ?? false,
    optedOut: extra.optedOut ?? false,
    source: 'manual',
  })
}

/** Only one primary per channel, matching the partial unique index. */
function clearPrimaryMethods(
  snapshot: WorkspaceSnapshot,
  customerId: string,
  method: CustomerContactMethod['method'],
): void {
  for (const item of snapshot.contactMethods) {
    if (item.customerId === customerId && item.method === method) item.isPrimary = false
  }
}

function normalizeContactValue(method: CustomerContactMethod['method'], value: string): string | null {
  if (method === 'email') return normalizeEmail(value)
  if (method === 'in_person' || method === 'other') return normalizeName(value)
  return normalizePhone(value)
}

function requireCustomer(snapshot: WorkspaceSnapshot, customerId: string): Customer {
  const customer = snapshot.customers.find((item) => item.id === customerId)
  if (customer === undefined) throw new Error('Customer not found.')
  return customer
}

function snapshotOfActivity(activity: Activity): Record<string, unknown> {
  return {
    type: activity.type,
    direction: activity.direction,
    method: activity.method,
    outcome: activity.outcome,
    summary: activity.summary,
    occurredAt: activity.occurredAt,
    performedByUser: activity.performedByUser,
  }
}

function nullableText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function stripUndefined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
