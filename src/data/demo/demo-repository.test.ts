import { beforeEach, describe, expect, it } from 'vitest'
import { DemoRepository } from './demo-repository.ts'
import { clearSnapshot } from './storage.ts'
import { buildCustomerRows, buildDashboard } from '../../domain/dashboard.ts'
import type { WorkspaceSnapshot } from '../workspace.ts'
import { isOpenFollowUpStatus } from '../../domain/vocabulary.ts'

/**
 * These exercise the demo repository directly, which is also the contract the
 * Supabase repository implements. The invariants asserted here — one open
 * follow-up, audit on correction, waiting never being a dead end — are the same
 * ones the database enforces, and the SQL suite asserts them again server-side.
 */
describe('DemoRepository', () => {
  let repository: DemoRepository

  beforeEach(() => {
    clearSnapshot()
    repository = new DemoRepository()
  })

  async function seedCustomer(fullName = 'Nora Vasquez', extra: Record<string, unknown> = {}) {
    const id = await repository.createCustomer({
      fullName,
      primaryPhone: '(555) 010-0400',
      primaryEmail: 'nora.vasquez@example.com',
      city: 'Abilene',
      state: 'tx',
      ...extra,
    })

    return id
  }

  function rowFor(snapshot: WorkspaceSnapshot, customerId: string) {
    const rows = buildCustomerRows({
      customers: snapshot.customers,
      contactMethods: snapshot.contactMethods,
      vehicleInterests: snapshot.vehicleInterests,
      activities: snapshot.activities,
      followUps: snapshot.followUps,
      timeZone: 'America/Chicago',
    })

    const row = rows.find((item) => item.customer.id === customerId)
    if (row === undefined) throw new Error('customer not found in rows')
    return row
  }

  describe('customers', () => {
    it('creates a customer with normalized keys and uppercases the state', async () => {
      const id = await seedCustomer()
      const snapshot = await repository.load()
      const customer = snapshot.customers.find((item) => item.id === id)

      expect(customer?.fullName).toBe('Nora Vasquez')
      expect(customer?.normalizedPhone).toBe('5550100400')
      expect(customer?.normalizedName).toBe('nora vasquez')
      expect(customer?.state).toBe('TX')
    })

    it('turns a typed phone and email into usable contact methods', async () => {
      const id = await seedCustomer()
      const snapshot = await repository.load()
      const methods = snapshot.contactMethods.filter((item) => item.customerId === id)

      expect(methods.map((item) => item.method).sort()).toEqual(['email', 'phone_call', 'sms'])
    })

    it('edits a customer without touching anything not in the patch', async () => {
      const id = await seedCustomer()
      await repository.updateCustomer(id, { city: 'Lubbock', leadTemperature: 'hot' })

      const snapshot = await repository.load()
      const customer = snapshot.customers.find((item) => item.id === id)

      expect(customer?.city).toBe('Lubbock')
      expect(customer?.leadTemperature).toBe('hot')
      expect(customer?.primaryEmail).toBe('nora.vasquez@example.com')
    })

    it('archives a customer and keeps the status and timestamp in agreement', async () => {
      const id = await seedCustomer()
      await repository.archiveCustomer(id)

      const snapshot = await repository.load()
      const customer = snapshot.customers.find((item) => item.id === id)

      expect(customer?.leadStatus).toBe('archived')
      expect(customer?.archivedAt).not.toBeNull()
    })

    it('restores an archived customer to an active status', async () => {
      const id = await seedCustomer()
      await repository.archiveCustomer(id)
      await repository.restoreCustomer(id, 'working')

      const snapshot = await repository.load()
      const customer = snapshot.customers.find((item) => item.id === id)

      expect(customer?.leadStatus).toBe('working')
      expect(customer?.archivedAt).toBeNull()
    })

    it('records a status change on the timeline', async () => {
      const id = await seedCustomer()
      await repository.setLeadStatus(id, 'sold')

      const snapshot = await repository.load()
      const statusChanges = snapshot.activities.filter(
        (item) => item.customerId === id && item.type === 'status_change',
      )

      expect(statusChanges).toHaveLength(1)
      // Internal activity is never a personal contact attempt.
      expect(statusChanges[0]?.performedByUser).toBe(false)
    })

    it('cancels the open follow-up when a customer is closed', async () => {
      const id = await seedCustomer()
      await repository.scheduleFollowUp({ customerId: id, dueAt: futureIso(24) })
      await repository.setLeadStatus(id, 'lost')

      const snapshot = await repository.load()
      const open = snapshot.followUps.filter(
        (item) => item.customerId === id && isOpenFollowUpStatus(item.status),
      )

      expect(open).toHaveLength(0)
    })
  })

  describe('contact methods', () => {
    it('adds a method and counts it as available', async () => {
      const id = await seedCustomer()
      await repository.addContactMethod(id, { method: 'whatsapp', value: '+15550100400' })

      const row = rowFor(await repository.load(), id)
      expect(row.coverage.methodsAvailable).toContain('whatsapp')
      // Available is not attempted: nothing has been tried on it.
      expect(row.coverage.methodsAttempted).not.toContain('whatsapp')
    })

    it('rejects a duplicate value on the same channel', async () => {
      const id = await seedCustomer()

      await expect(
        repository.addContactMethod(id, { method: 'phone_call', value: '555-010-0400' }),
      ).rejects.toThrow(/already on file/i)
    })
  })

  describe('communication accounting', () => {
    it('counts a personal attempt but not CRM-visible automated activity', async () => {
      const id = await seedCustomer()

      await repository.logActivity({
        customerId: id,
        type: 'outbound_call',
        direction: 'outbound',
        method: 'phone_call',
        outcome: 'no_answer',
        performedByUser: true,
      })

      await repository.logActivity({
        customerId: id,
        type: 'outbound_email',
        direction: 'outbound',
        method: 'email',
        outcome: 'no_reply',
        source: 'screenshot',
        performedByUser: false,
      })

      const row = rowFor(await repository.load(), id)

      expect(row.coverage.methodsAttempted).toEqual(['phone_call'])
      expect(row.coverage.methodsNotAttempted).toContain('email')
      expect(row.coverage.totalAttempts).toBe(1)
    })

    it('never marks an internal activity as a personal attempt', async () => {
      const id = await seedCustomer()

      await repository.logActivity({
        customerId: id,
        type: 'note',
        direction: 'internal',
        // Even when a caller insists, the rule wins.
        performedByUser: true,
      })

      const snapshot = await repository.load()
      const note = snapshot.activities.find((item) => item.customerId === id && item.type === 'note')

      expect(note?.performedByUser).toBe(false)
    })

    it('records a correction in the audit log with the previous value', async () => {
      const id = await seedCustomer()
      await repository.logActivity({
        customerId: id,
        type: 'outbound_call',
        direction: 'outbound',
        outcome: 'no_answer',
        performedByUser: true,
      })

      const before = await repository.load()
      const activity = before.activities.find((item) => item.customerId === id)
      expect(activity).toBeDefined()

      await repository.updateActivity(
        activity?.id ?? '',
        { outcome: 'connected' },
        'Logged the wrong outcome',
      )

      const after = await repository.load()
      const entry = after.auditEntries.find((item) => item.recordId === activity?.id)
      expect(entry).toBeDefined()
      if (entry === undefined) throw new Error('audit entry missing')

      expect(entry.action).toBe('update')
      expect(entry.metadata['reason']).toBe('Logged the wrong outcome')
      expect((entry.metadata['before'] as { outcome: string }).outcome).toBe('no_answer')
      expect((entry.metadata['after'] as { outcome: string }).outcome).toBe('connected')

      const corrected = after.activities.find((item) => item.id === activity?.id)
      expect(corrected?.outcome).toBe('connected')
    })
  })

  describe('follow-ups', () => {
    it('schedules a follow-up and moves the customer out of no-next-action', async () => {
      const id = await seedCustomer()

      let row = rowFor(await repository.load(), id)
      expect(row.nextAction.state).toBe('no_next_action')

      await repository.scheduleFollowUp({
        customerId: id,
        dueAt: futureIso(24),
        reason: 'Send the spec sheet',
      })

      row = rowFor(await repository.load(), id)
      expect(row.nextAction.state).toBe('follow_up_scheduled')
      expect(row.openFollowUp?.reason).toBe('Send the spec sheet')
    })

    it('keeps only one open follow-up per customer when rescheduling', async () => {
      const id = await seedCustomer()
      await repository.scheduleFollowUp({ customerId: id, dueAt: futureIso(24) })
      await repository.scheduleFollowUp({ customerId: id, dueAt: futureIso(48) })

      const snapshot = await repository.load()
      const all = snapshot.followUps.filter((item) => item.customerId === id)
      const open = all.filter((item) => isOpenFollowUpStatus(item.status))

      expect(open).toHaveLength(1)
      // The previous one is preserved rather than discarded.
      expect(all).toHaveLength(2)
    })

    it('links a rescheduled follow-up to the one it replaced', async () => {
      const id = await seedCustomer()
      await repository.scheduleFollowUp({ customerId: id, dueAt: futureIso(24) })

      const first = (await repository.load()).followUps.find((item) => item.customerId === id)
      await repository.scheduleFollowUp({ customerId: id, dueAt: futureIso(48) })

      const snapshot = await repository.load()
      const replacement = snapshot.followUps.find(
        (item) => item.customerId === id && isOpenFollowUpStatus(item.status),
      )
      const replaced = snapshot.followUps.find((item) => item.id === first?.id)

      expect(replacement?.rescheduledFromId).toBe(first?.id)
      expect(replaced?.status).toBe('canceled')
      expect(replaced?.outcomeNote).toMatch(/replaced/i)
    })

    it('completes a follow-up and leaves the customer needing a next action', async () => {
      const id = await seedCustomer()
      await repository.scheduleFollowUp({ customerId: id, dueAt: futureIso(24) })
      await repository.completeFollowUp(id)

      const row = rowFor(await repository.load(), id)

      expect(row.openFollowUp).toBeNull()
      // Completing without booking the next one is exactly how a lead goes
      // quiet, so it must land back in the queue.
      expect(row.nextAction.state).toBe('no_next_action')
    })

    it('snoozes a follow-up without replacing it', async () => {
      const id = await seedCustomer()
      await repository.scheduleFollowUp({ customerId: id, dueAt: futureIso(1), reason: 'Call back' })

      const open = (await repository.load()).followUps.find((item) => item.customerId === id)
      await repository.snoozeFollowUp(open?.id ?? '', futureIso(72))

      const row = rowFor(await repository.load(), id)

      expect(row.openFollowUp?.id).toBe(open?.id)
      expect(row.openFollowUp?.status).toBe('snoozed')
      expect(row.openFollowUp?.reason).toBe('Call back')
      expect(row.nextAction.isOverdue).toBe(false)
    })
  })

  describe('waiting for customer', () => {
    it('parks the customer with a deadline rather than a dead end', async () => {
      const id = await seedCustomer()

      await repository.logActivity(
        {
          customerId: id,
          type: 'outbound_email',
          direction: 'outbound',
          method: 'email',
          performedByUser: true,
        },
        { kind: 'waiting', waitingUntil: futureIso(72), reason: 'Payoff amount', resolution: 'complete' },
      )

      const row = rowFor(await repository.load(), id)

      expect(row.openFollowUp?.status).toBe('waiting_on_customer')
      expect(row.openFollowUp?.waitingUntil).not.toBeNull()
      expect(row.nextAction.state).toBe('waiting_on_customer')
    })

    it('returns a lapsed waiting deadline to the action queue', async () => {
      const id = await seedCustomer()
      await repository.scheduleFollowUp({
        customerId: id,
        dueAt: pastIso(2),
        waitingUntil: pastIso(2),
      })

      const expired = await repository.expireWaitingFollowUps(new Date())
      expect(expired).toBe(1)

      const row = rowFor(await repository.load(), id)
      expect(row.openFollowUp?.status).toBe('overdue')
      expect(row.openFollowUp?.waitingUntil).toBeNull()
      expect(row.nextAction.isOverdue).toBe(true)
    })

    it('is idempotent, so running it twice changes nothing further', async () => {
      const id = await seedCustomer()
      await repository.scheduleFollowUp({ customerId: id, dueAt: pastIso(2), waitingUntil: pastIso(2) })

      await repository.expireWaitingFollowUps(new Date())
      expect(await repository.expireWaitingFollowUps(new Date())).toBe(0)
    })

    it('clears the waiting state when the customer responds', async () => {
      const id = await seedCustomer()
      await repository.scheduleFollowUp({
        customerId: id,
        dueAt: futureIso(72),
        waitingUntil: futureIso(72),
      })

      await repository.logActivity({
        customerId: id,
        type: 'inbound_text',
        direction: 'inbound',
        method: 'sms',
        outcome: 'replied',
        performedByUser: false,
      })

      const row = rowFor(await repository.load(), id)

      expect(row.openFollowUp?.status).toBe('pending')
      expect(row.openFollowUp?.waitingUntil).toBeNull()
      // Due now, so it asks for the next decision rather than staying parked.
      expect(row.nextAction.isOverdue).toBe(true)
    })
  })

  describe('dashboard queues', () => {
    it('keeps an overdue lead visible and excludes closed customers', async () => {
      const overdueId = await seedCustomer('Overdue Person')
      await repository.scheduleFollowUp({ customerId: overdueId, dueAt: pastIso(48) })

      const soldId = await seedCustomer('Sold Person', { primaryPhone: '(555) 010-0401', primaryEmail: null })
      await repository.scheduleFollowUp({ customerId: soldId, dueAt: pastIso(48) })
      await repository.setLeadStatus(soldId, 'sold')

      const archivedId = await seedCustomer('Archived Person', {
        primaryPhone: '(555) 010-0402',
        primaryEmail: null,
      })
      await repository.archiveCustomer(archivedId)

      const snapshot = await repository.load()
      const dashboard = buildDashboard({
        customers: snapshot.customers,
        contactMethods: snapshot.contactMethods,
        vehicleInterests: snapshot.vehicleInterests,
        activities: snapshot.activities,
        followUps: snapshot.followUps,
        timeZone: 'America/Chicago',
      })

      const overdueNames = dashboard.overdue.map((row) => row.customer.fullName)
      expect(overdueNames).toContain('Overdue Person')
      expect(overdueNames).not.toContain('Sold Person')

      const allNames = [...dashboard.noNextAction, ...dashboard.overdue].map(
        (row) => row.customer.fullName,
      )
      expect(allNames).not.toContain('Archived Person')
    })
  })

  describe('settings', () => {
    it('saves scheduling preferences', async () => {
      await repository.updateSettings({ waitingTimeoutHours: 12, morningAt: '07:30' })
      const snapshot = await repository.load()

      expect(snapshot.profile.waitingTimeoutHours).toBe(12)
      expect(snapshot.profile.morningAt).toBe('07:30')
    })
  })

  describe('demo data', () => {
    it('resets back to the fictional fixtures', async () => {
      const id = await seedCustomer('Temporary Person')
      expect((await repository.load()).customers.some((item) => item.id === id)).toBe(true)

      await repository.resetDemoData()

      const snapshot = await repository.load()
      expect(snapshot.customers.some((item) => item.id === id)).toBe(false)
      expect(snapshot.customers.some((item) => item.fullName === 'Jesus Ayala')).toBe(true)
    })
  })
})

function futureIso(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString()
}

function pastIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString()
}
