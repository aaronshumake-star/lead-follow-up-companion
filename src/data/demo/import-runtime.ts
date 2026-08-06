/**
 * Executes screenshot imports, simulated reminders and simulated inbound
 * commands against a demo snapshot.
 *
 * Demo mode runs the *real* engines — the decision engine, the import planner,
 * the reminder planner with its idempotency keys, the command parser and the
 * executor. Only the image bytes and the WhatsApp transport are simulated, so a
 * duplicate suppressed here would be suppressed in production too, and a
 * command that parses here parses there.
 */

import type { Activity, AuditEntry, Screenshot, UsageEvent } from '../../domain/models.ts'
import type {
  ApplyImportInput,
  ImportOutcome,
  SimulatedDispatch,
  SimulatedInbound,
  WorkspaceSnapshot,
} from '../workspace.ts'
import { newId } from './storage.ts'
import type { ImportDecision } from '../../domain/screenshot/decision-engine.ts'
import { isAutomatic } from '../../domain/screenshot/decision-engine.ts'
import { emptyExtraction, type ExtractionResult } from '../../domain/screenshot/extraction.ts'
import { buildImportPlan } from '../../domain/screenshot/import-plan.ts'
import { planAutoFollowUp } from '../../domain/screenshot/auto-follow-up.ts'
import { buildCustomerRows } from '../../domain/dashboard.ts'
import { settingsFromProfile } from '../../domain/settings.ts'
import { planReminders } from '../../domain/messaging/reminder-engine.ts'
import { parseCommand } from '../../domain/messaging/command-parser.ts'
import { executeCommand } from '../../domain/messaging/command-executor.ts'
import { composeCommandConfirmation } from '../../domain/messaging/messages.ts'
import { isApprovedSender } from '../../providers/whatsapp/types.ts'
import { normalizeEmail, normalizePhone } from '../../lib/normalize.ts'
import { isOpenFollowUpStatus } from '../../domain/vocabulary.ts'

/** Demo mode stands in for the approved number so the flow is exercisable. */
export const DEMO_APPROVED_NUMBER = '+15550100999'

export interface ApplyImportOptions extends ApplyImportInput {
  ignoredFields?: readonly string[]
  /** Set when re-applying an existing capture from the review queue. */
  existingScreenshotId?: string
}

export function applyImport(snapshot: WorkspaceSnapshot, input: ApplyImportOptions): ImportOutcome {
  const now = input.now ?? new Date()
  const settings = settingsFromProfile(snapshot.profile)
  const extraction = input.extraction ?? emptyExtraction()

  const screenshot = upsertScreenshot(snapshot, input, now)
  storeExtractionFields(snapshot, screenshot.id, extraction, input.unverifiedFields)
  storeMatchCandidates(snapshot, screenshot.id, input)

  // Non-automatic decisions record what was concluded and stop there. Nothing
  // is written to a customer until a person resolves the item.
  if (!isAutomatic(input.decision)) {
    screenshot.status = input.decision === 'DUPLICATE_IGNORED' ? 'discarded' : 'needs_review'

    pushAudit(snapshot, 'insert', 'screenshots', screenshot.id, `Screenshot: ${input.decision}`, {
      decision: input.decision,
      reason: input.decisionReason,
    })

    return {
      screenshotId: screenshot.id,
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
    ignoredFields: input.ignoredFields,
  })

  const customerId = existing === null ? createCustomer(snapshot, plan, now) : existing.id
  const customer = snapshot.customers.find((item) => item.id === customerId)
  if (customer === undefined) throw new Error('Customer could not be created.')

  if (existing !== null && plan.updatePatch !== null) {
    Object.assign(customer, stripUndefined(plan.updatePatch))
    customer.updatedAt = now.toISOString()
    if (plan.updatePatch.primaryPhone !== undefined) {
      customer.normalizedPhone = normalizePhone(customer.primaryPhone)
    }
    if (plan.updatePatch.primaryEmail !== undefined) {
      customer.normalizedEmail = normalizeEmail(customer.primaryEmail)
    }
  }

  for (const method of plan.contactMethods) {
    snapshot.contactMethods.push({
      id: newId(),
      customerId,
      method: method.method,
      value: method.value,
      label: 'From a screenshot',
      isPrimary: false,
      // Availability seen in an image is not a confirmed channel.
      isVerified: method.verified,
      optedOut: false,
      source: 'screenshot',
    })
  }

  if (plan.vehicle !== null) {
    snapshot.vehicleInterests.push({ id: newId(), customerId, ...plan.vehicle })
  }

  for (const activity of plan.activities) {
    snapshot.activities.push({
      id: newId(),
      customerId,
      type: activity.type,
      direction: activity.direction,
      method: null,
      outcome: null,
      summary: activity.summary,
      rawText: null,
      occurredAt: activity.occurredAt ?? now.toISOString(),
      source: 'screenshot',
      // The rule the whole product rests on: a screenshot never proves I did it.
      performedByUser: false,
      externalMessageId: null,
    })
  }

  snapshot.activities.push({
    id: newId(),
    customerId,
    type: 'screenshot_import',
    direction: 'internal',
    method: null,
    outcome: null,
    summary: `Imported from a screenshot (${input.decision})`,
    rawText: null,
    occurredAt: now.toISOString(),
    source: 'screenshot',
    performedByUser: false,
    externalMessageId: null,
  })

  customer.lastActivityAt = now.toISOString()

  // --- automatic follow-up --------------------------------------------------
  const followUpPlan = planAutoFollowUp(
    customer,
    snapshot.followUps.filter((item) => item.customerId === customerId),
    settings,
    { isNewCustomer: existing === null, now },
  )

  let followUpDueAt: string | null = null

  if (followUpPlan.dueAt !== null) {
    snapshot.followUps.push({
      id: newId(),
      customerId,
      dueAt: followUpPlan.dueAt.toISOString(),
      status: 'pending',
      priority: settings.defaultLeadPriority,
      reason: followUpPlan.description,
      recommendedMethod: null,
      waitingUntil: null,
      completedAt: null,
      snoozedUntil: null,
      reminderStatus: 'not_scheduled',
      whatsappMessageId: null,
      isAppointment: false,
      canceledAt: null,
      outcomeNote: null,
      rescheduledFromId: null,
      createdAt: now.toISOString(),
    })

    followUpDueAt = followUpPlan.dueAt.toISOString()
    if (customer.leadStatus === 'new' || customer.leadStatus === 'working') {
      customer.leadStatus = 'follow_up_scheduled'
    }
    plan.changes.push('Follow-up scheduled')
  } else if (followUpPlan.reason === 'kept_existing') {
    plan.changes.push('Existing follow-up kept')
  }

  // --- finalise the capture -------------------------------------------------
  screenshot.status = 'applied'
  screenshot.customerId = customerId
  finalizeScreenshot(screenshot, now)

  pushAudit(snapshot, existing === null ? 'insert' : 'update', 'customers', customerId, `Screenshot import: ${input.decision}`, {
    decision: input.decision,
    reason: input.decisionReason,
    screenshotId: screenshot.id,
    unverifiedFields: [...input.unverifiedFields],
  })

  return {
    screenshotId: screenshot.id,
    decision: input.decision,
    reason: input.decisionReason,
    customerId,
    customerName: customer.fullName,
    changes: plan.changes.map((label) => ({ label })),
    followUpDueAt,
    requiresReview: false,
    // Only a freshly created customer can be removed cleanly; an update has
    // merged into an existing record and unpicking it is not safe.
    undoable: existing === null,
  }
}

function createCustomer(
  snapshot: WorkspaceSnapshot,
  plan: ReturnType<typeof buildImportPlan>,
  now: Date,
): string {
  const draft = plan.createDraft
  if (draft === null) throw new Error('No customer draft to create.')

  const id = newId()
  const iso = now.toISOString()

  snapshot.customers.push({
    id,
    userId: snapshot.profile.id,
    fullName: draft.fullName,
    firstName: draft.firstName ?? null,
    lastName: draft.lastName ?? null,
    normalizedName: draft.fullName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    primaryPhone: draft.primaryPhone ?? null,
    normalizedPhone: normalizePhone(draft.primaryPhone ?? null),
    primaryEmail: draft.primaryEmail ?? null,
    normalizedEmail: normalizeEmail(draft.primaryEmail ?? null),
    dealershipCustomerId: draft.dealershipCustomerId ?? null,
    city: draft.city ?? null,
    state: draft.state ?? null,
    preferredLanguage: draft.preferredLanguage ?? 'unknown',
    salesperson: draft.salesperson ?? null,
    leadSource: draft.leadSource ?? null,
    leadPriority: draft.leadPriority ?? 'normal',
    leadTemperature: 'unknown',
    leadStatus: draft.leadStatus ?? 'new',
    preferredContactMethod: null,
    notes: draft.notes ?? null,
    pinnedNote: null,
    objections: null,
    tradeNotes: null,
    financeStatus: null,
    source: 'screenshot',
    lastActivityAt: iso,
    archivedAt: null,
    createdAt: iso,
    updatedAt: iso,
  })

  return id
}

function upsertScreenshot(
  snapshot: WorkspaceSnapshot,
  input: ApplyImportOptions,
  now: Date,
): Screenshot {
  const existing =
    input.existingScreenshotId === undefined
      ? undefined
      : snapshot.screenshots.find((item) => item.id === input.existingScreenshotId)

  const record: Screenshot =
    existing ??
    ({
      id: newId(),
      customerId: null,
      fileHash: input.screenshot.fileHash,
      mimeType: input.screenshot.mimeType,
      byteSize: input.screenshot.byteSize,
      status: 'extracting',
      extractionProvider: input.extractionProvider,
      rawText: input.rawText,
      capturedAt: input.screenshot.capturedAt ?? now.toISOString(),
      createdAt: now.toISOString(),
      decision: null,
      decisionReason: null,
      overallConfidence: null,
      warnings: [],
      containsMultipleCustomers: false,
      imageWidth: input.screenshot.imageWidth,
      imageHeight: input.screenshot.imageHeight,
      originalFilename: input.screenshot.originalFilename,
      retained: input.retainImage,
      reviewResolvedAt: null,
      reviewAction: null,
    } satisfies Screenshot)

  if (existing === undefined) snapshot.screenshots.push(record)

  record.decision = input.decision
  record.decisionReason = input.decisionReason
  record.overallConfidence = input.extraction?.overallConfidence ?? null
  record.warnings = [...input.warnings]
  record.containsMultipleCustomers = input.extraction?.containsMultipleCustomers ?? false
  record.retained = input.retainImage

  return record
}

/**
 * Screenshots are discarded after a successful extraction by default: once the
 * capture has been applied there is nothing left to review, so only the hash
 * survives. Retention is opt-in and keeps the text as well.
 */
function finalizeScreenshot(record: Screenshot, now: Date): void {
  if (!record.retained) record.rawText = null
  record.capturedAt ??= now.toISOString()
}

function storeExtractionFields(
  snapshot: WorkspaceSnapshot,
  screenshotId: string,
  extraction: ExtractionResult,
  unverifiedFields: readonly string[],
): void {
  snapshot.extractionFields = snapshot.extractionFields.filter(
    (field) => field.screenshotId !== screenshotId,
  )

  const unverified = new Set(unverifiedFields)
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

  for (const [key, value, confidence] of entries) {
    if (value === null) continue

    snapshot.extractionFields.push({
      id: newId(),
      screenshotId,
      fieldKey: key,
      fieldValue: value,
      confidence,
      accepted: null,
      verified: !unverified.has(key) && confidence >= 0.75,
      appliedAsUnverified: unverified.has(key),
    })
  }
}

function storeMatchCandidates(
  snapshot: WorkspaceSnapshot,
  screenshotId: string,
  input: ApplyImportOptions,
): void {
  snapshot.matchCandidates = snapshot.matchCandidates.filter(
    (candidate) => candidate.screenshotId !== screenshotId,
  )

  for (const candidate of input.candidates) {
    snapshot.matchCandidates.push({
      id: newId(),
      screenshotId,
      customerId: candidate.customer.id,
      score: candidate.score,
      reasons: [...candidate.reasons],
      conflicts: candidate.conflicts.map((conflict) => ({ ...conflict })),
      selected: candidate.customer.id === input.targetCustomerId,
    })
  }
}

export function readStoredExtraction(
  snapshot: WorkspaceSnapshot,
  screenshotId: string,
): ExtractionResult {
  const extraction = emptyExtraction()
  const fields = snapshot.extractionFields.filter((field) => field.screenshotId === screenshotId)

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

export function pushAudit(
  snapshot: WorkspaceSnapshot,
  action: AuditEntry['action'],
  tableName: string,
  recordId: string | null,
  summary: string,
  metadata: Record<string, unknown>,
): void {
  snapshot.auditEntries.push({
    id: newId(),
    action,
    tableName,
    recordId,
    summary,
    metadata,
    createdAt: new Date().toISOString(),
  })
}

// ---------------------------------------------------------------------------
// Simulated WhatsApp
// ---------------------------------------------------------------------------

export function runSimulatedReminders(snapshot: WorkspaceSnapshot, now: Date): SimulatedDispatch {
  const settings = settingsFromProfile(snapshot.profile)
  const rows = buildCustomerRows({
    customers: snapshot.customers,
    contactMethods: snapshot.contactMethods,
    vehicleInterests: snapshot.vehicleInterests,
    activities: snapshot.activities,
    followUps: snapshot.followUps,
    timeZone: settings.timeZone,
    now,
  })

  const jobs = planReminders({ rows, settings, now })

  const sent: SimulatedDispatch['sent'] = []
  const suppressed: SimulatedDispatch['suppressed'] = []

  for (const job of jobs) {
    // The same claim the scheduler performs: the idempotency key is unique, so
    // a second attempt at the same logical message never sends.
    const alreadyClaimed = snapshot.notifications.some(
      (entry) => entry.idempotencyKey === job.idempotencyKey,
    )

    if (alreadyClaimed) {
      suppressed.push({
        stage: job.stage,
        idempotencyKey: job.idempotencyKey,
        reason: 'Already sent — idempotency key already claimed',
      })
      continue
    }

    const iso = now.toISOString()
    snapshot.notifications.push({
      id: newId(),
      customerId: job.customerId,
      followUpId: job.followUpId,
      kind: job.stage.endsWith('digest') ? 'morning_summary' : 'follow_up_reminder',
      status: 'sent',
      idempotencyKey: job.idempotencyKey,
      reminderStage: job.stage,
      payloadSummary: job.payloadSummary,
      billable: true,
      attemptCount: 1,
      error: null,
      permanentFailure: false,
      nextAttemptAt: null,
      sentAt: iso,
      createdAt: iso,
    })

    snapshot.usageEvents.push(usage('message_sent', 1, 0.015))
    snapshot.usageEvents.push(usage('reminder_generated', 1, 0))

    sent.push({ stage: job.stage, body: job.body, idempotencyKey: job.idempotencyKey })
  }

  return { sent, suppressed, expiredWaiting: 0 }
}

export function runSimulatedInbound(
  snapshot: WorkspaceSnapshot,
  fromE164: string,
  text: string,
  now: Date,
): SimulatedInbound {
  // The authorization check, identical to the webhook's. Fails closed.
  if (!isApprovedSender(fromE164, DEMO_APPROVED_NUMBER)) {
    pushAudit(snapshot, 'access_denied', 'inbound_commands', null, 'Rejected: sender is not approved', {
      reason: 'unapproved_sender',
    })

    return {
      accepted: false,
      reply: '',
      // Deliberately says nothing about any customer.
      rejectionReason: 'This number is not authorised to use this application.',
    }
  }

  snapshot.usageEvents.push(usage('message_received', 1, 0))

  const settings = settingsFromProfile(snapshot.profile)
  const rows = buildCustomerRows({
    customers: snapshot.customers,
    contactMethods: snapshot.contactMethods,
    vehicleInterests: snapshot.vehicleInterests,
    activities: snapshot.activities,
    followUps: snapshot.followUps,
    timeZone: settings.timeZone,
    now,
  })

  const open = snapshot.clarificationSessions.find(
    (session) => session.resolvedAt === null && new Date(session.expiresAt).getTime() > now.getTime(),
  )

  const parsed = parseCommand(text, { settings, now, hasOpenClarification: open !== undefined })

  const recentReminderCustomerIds = snapshot.notifications
    .filter((entry) => entry.customerId !== null && entry.reminderStage !== null)
    .slice(-5)
    .map((entry) => entry.customerId as string)

  const plan = executeCommand(parsed, {
    rows,
    settings,
    now,
    recentReminderCustomerIds,
    openClarification:
      open === undefined
        ? null
        : { options: open.options, pendingPayload: open.pendingPayload },
  })

  // Any reply resolves the outstanding question, so an abandoned one cannot
  // capture an unrelated message later.
  if (open !== undefined) {
    open.resolvedAt = now.toISOString()
    open.resolution = plan.kind
  }

  let reply: string

  switch (plan.kind) {
    case 'reply':
      reply = plan.body
      break

    case 'clarify':
      snapshot.clarificationSessions.push({
        id: newId(),
        kind: plan.sessionKind,
        prompt: plan.prompt,
        options: plan.options,
        pendingPayload: plan.pendingPayload,
        // Expiring matters: a stale question would silently swallow a later "1".
        expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
        resolvedAt: null,
        resolution: null,
        createdAt: now.toISOString(),
      })
      reply = plan.prompt
      break

    case 'rejected':
      reply = plan.reason
      break

    case 'apply': {
      applyCommandEffects(snapshot, plan.customerId, plan.effects, now)
      pushAudit(snapshot, 'update', 'customers', plan.customerId, 'Updated from a WhatsApp command', {
        changes: plan.changes,
      })
      reply = composeCommandConfirmation(plan.customerName, plan.changes)
      break
    }
  }

  snapshot.usageEvents.push(usage('message_sent', 1, 0))

  return { accepted: true, reply }
}

function applyCommandEffects(
  snapshot: WorkspaceSnapshot,
  customerId: string,
  effects: readonly import('../../domain/messaging/command-executor.ts').CommandEffect[],
  now: Date,
): void {
  const customer = snapshot.customers.find((item) => item.id === customerId)
  if (customer === undefined) return

  const closeOpen = (status: 'completed' | 'canceled', note: string) => {
    const open = snapshot.followUps.find(
      (item) => item.customerId === customerId && isOpenFollowUpStatus(item.status),
    )
    if (open === undefined) return null

    open.status = status
    open.completedAt = status === 'completed' ? now.toISOString() : null
    open.canceledAt = status === 'canceled' ? now.toISOString() : null
    open.snoozedUntil = null
    open.waitingUntil = null
    open.outcomeNote ??= note
    return open.id
  }

  for (const effect of effects) {
    switch (effect.type) {
      case 'log_activity': {
        const activity: Activity = {
          id: newId(),
          customerId,
          type: effect.activityType,
          direction: effect.direction,
          method: effect.method,
          outcome: effect.outcome,
          summary: effect.summary,
          rawText: null,
          occurredAt: now.toISOString(),
          source: 'whatsapp',
          // A command is me saying I did it, so this is a personal attempt.
          performedByUser: effect.direction === 'outbound',
          externalMessageId: null,
        }
        snapshot.activities.push(activity)
        customer.lastActivityAt = activity.occurredAt
        break
      }

      case 'complete_follow_up':
        closeOpen('completed', 'Completed from WhatsApp')
        break

      case 'snooze': {
        const open = snapshot.followUps.find(
          (item) => item.customerId === customerId && isOpenFollowUpStatus(item.status),
        )
        if (open !== undefined) {
          open.status = 'snoozed'
          open.snoozedUntil = effect.until
          open.waitingUntil = null
        }
        break
      }

      case 'schedule_follow_up': {
        const previous = closeOpen('completed', 'Replaced from WhatsApp')
        snapshot.followUps.push(makeFollowUp(customerId, effect.dueAt, effect.reason, now, previous, effect.isAppointment, null))
        if (!['sold', 'lost', 'do_not_contact', 'archived'].includes(customer.leadStatus)) {
          customer.leadStatus = effect.isAppointment ? 'appointment_scheduled' : 'follow_up_scheduled'
        }
        break
      }

      case 'set_waiting': {
        const previous = closeOpen('completed', 'Replaced from WhatsApp')
        snapshot.followUps.push(
          makeFollowUp(customerId, effect.waitingUntil, effect.reason, now, previous, false, effect.waitingUntil),
        )
        customer.leadStatus = 'waiting_on_customer'
        break
      }

      case 'set_status': {
        customer.leadStatus = effect.status
        customer.archivedAt = effect.status === 'archived' ? now.toISOString() : null
        if (['sold', 'lost', 'do_not_contact', 'archived'].includes(effect.status)) {
          closeOpen('canceled', `Customer marked ${effect.status}`)
        }
        snapshot.activities.push({
          id: newId(),
          customerId,
          type: 'status_change',
          direction: 'internal',
          method: null,
          outcome: null,
          summary: `Status changed to ${effect.status} from WhatsApp`,
          rawText: null,
          occurredAt: now.toISOString(),
          source: 'whatsapp',
          performedByUser: false,
          externalMessageId: null,
        })
        break
      }

      case 'add_note': {
        customer.notes = customer.notes === null ? effect.note : `${customer.notes}\n${effect.note}`
        snapshot.activities.push({
          id: newId(),
          customerId,
          type: 'note',
          direction: 'internal',
          method: null,
          outcome: null,
          summary: effect.note,
          rawText: null,
          occurredAt: now.toISOString(),
          source: 'whatsapp',
          performedByUser: false,
          externalMessageId: null,
        })
        break
      }
    }
  }

  customer.updatedAt = now.toISOString()
}

function makeFollowUp(
  customerId: string,
  dueAt: string,
  reason: string,
  now: Date,
  previousId: string | null,
  isAppointment: boolean,
  waitingUntil: string | null,
) {
  return {
    id: newId(),
    customerId,
    dueAt,
    status: waitingUntil === null ? ('pending' as const) : ('waiting_on_customer' as const),
    priority: 'normal' as const,
    reason,
    recommendedMethod: null,
    waitingUntil,
    completedAt: null,
    snoozedUntil: null,
    reminderStatus: 'not_scheduled' as const,
    whatsappMessageId: null,
    isAppointment,
    canceledAt: null,
    outcomeNote: null,
    rescheduledFromId: previousId,
    createdAt: now.toISOString(),
  }
}

function usage(kind: UsageEvent['kind'], quantity: number, cost: number): UsageEvent {
  return {
    id: newId(),
    kind,
    quantity,
    estimatedCostUsd: cost,
    occurredAt: new Date().toISOString(),
  }
}

function stripUndefined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>
}

export type { ImportDecision }
