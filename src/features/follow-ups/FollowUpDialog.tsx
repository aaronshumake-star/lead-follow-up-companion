import { useMemo, useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { CheckboxField, SelectField, TextField } from '../../components/ui/Field.tsx'
import {
  CONTACT_METHODS,
  CONTACT_METHOD_LABELS,
  LEAD_PRIORITIES,
  LEAD_PRIORITY_LABELS,
} from '../../domain/vocabulary.ts'
import type { ContactMethod, LeadPriority } from '../../domain/vocabulary.ts'
import {
  defaultWaitingDeadline,
  parseLocalDateTimeInput,
  resolvePreset,
  toLocalDateTimeInput,
  type FollowUpPreset,
} from '../../domain/follow-up-presets.ts'
import type { UserSettings } from '../../domain/settings.ts'
import type { ScheduleFollowUpInput } from '../../data/workspace.ts'
import { formatDateTime } from '../../lib/format.ts'
import type { CustomerRow } from '../../domain/dashboard.ts'

export type FollowUpDialogMode = 'schedule' | 'reschedule' | 'snooze' | 'waiting' | 'appointment'

const MODE_TITLES: Record<FollowUpDialogMode, string> = {
  schedule: 'Schedule follow-up',
  reschedule: 'Reschedule follow-up',
  snooze: 'Snooze follow-up',
  waiting: 'Waiting for customer',
  appointment: 'Set appointment',
}

const MODE_DESCRIPTIONS: Record<FollowUpDialogMode, string> = {
  schedule: 'Give this customer a next action so they cannot be forgotten.',
  reschedule: 'The current follow-up is kept in history and linked to the new one.',
  snooze: 'The follow-up stays open and comes back at the time you choose.',
  waiting: 'Waiting always has a deadline. If nothing arrives, this returns to Action required.',
  appointment: 'Appointments get their own dashboard queue.',
}

const PRESETS: Array<{ value: FollowUpPreset; label: string }> = [
  { value: 'later_today', label: 'Later today' },
  { value: 'tomorrow_morning', label: 'Tomorrow morning' },
  { value: 'tomorrow_afternoon', label: 'Tomorrow afternoon' },
  { value: 'in_two_days', label: 'In two days' },
  { value: 'in_three_days', label: 'In three days' },
  { value: 'next_week', label: 'Next week' },
  { value: 'custom', label: 'Custom date and time' },
]

export interface FollowUpDialogResult {
  mode: FollowUpDialogMode
  input: ScheduleFollowUpInput
  summary: string
}

export function FollowUpDialog({
  open,
  mode,
  row,
  settings,
  onSubmit,
  onClose,
}: {
  open: boolean
  mode: FollowUpDialogMode
  row: CustomerRow
  settings: UserSettings
  onSubmit: (result: FollowUpDialogResult) => Promise<void>
  onClose: () => void
}) {
  const now = useMemo(() => new Date(), [])
  const isWaiting = mode === 'waiting'

  const [preset, setPreset] = useState<FollowUpPreset>(
    mode === 'snooze' ? 'in_three_days' : 'tomorrow_morning',
  )
  const [customValue, setCustomValue] = useState(() =>
    toLocalDateTimeInput(
      isWaiting ? defaultWaitingDeadline(settings, now) : new Date(now.getTime() + 86_400_000),
      settings.timeZone,
    ),
  )
  const [reason, setReason] = useState(row.openFollowUp?.reason ?? '')
  const [priority, setPriority] = useState<LeadPriority>(
    row.openFollowUp?.priority ?? settings.defaultLeadPriority,
  )
  const [method, setMethod] = useState<ContactMethod | ''>(
    row.openFollowUp?.recommendedMethod ?? row.coverage.recommendedNextMethod ?? '',
  )
  const [completeCurrent, setCompleteCurrent] = useState(mode === 'schedule')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Waiting always takes an explicit deadline; the presets are for tasks.
  const usesPresets = !isWaiting
  const resolved = usesPresets && preset !== 'custom'
    ? resolvePreset(preset, settings, now)
    : parseLocalDateTimeInput(customValue, settings.timeZone)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (resolved === null) {
      setError('Choose a valid date and time.')
      return
    }

    const input: ScheduleFollowUpInput = {
      customerId: row.customer.id,
      dueAt: resolved.toISOString(),
      reason: reason.trim() === '' ? null : reason.trim(),
      recommendedMethod: method === '' ? null : method,
      priority,
      waitingUntil: isWaiting ? resolved.toISOString() : null,
      isAppointment: mode === 'appointment',
      // Rescheduling records the previous follow-up as replaced; completing
      // records it as done. Neither discards it.
      resolution: completeCurrent ? 'complete' : 'reschedule',
    }

    setSubmitting(true)
    try {
      await onSubmit({
        mode,
        input,
        summary: `${MODE_TITLES[mode]} set for ${formatDateTime(resolved.toISOString(), settings.timeZone)}`,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the follow-up.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={`${MODE_TITLES[mode]} — ${row.customer.fullName}`}
      description={MODE_DESCRIPTIONS[mode]}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="follow-up-form" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="follow-up-form" onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        {usesPresets && (
          <SelectField
            label="When"
            value={preset}
            onChange={(event) => setPreset(event.target.value as FollowUpPreset)}
            options={PRESETS}
          />
        )}

        {(!usesPresets || preset === 'custom') && (
          <TextField
            label={isWaiting ? 'Response deadline' : 'Date and time'}
            type="datetime-local"
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            required
          />
        )}

        <TextField
          label={isWaiting ? 'Waiting for what?' : 'Reason'}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={isWaiting ? 'Payoff amount, financing decision…' : 'What needs to happen'}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as LeadPriority)}
            options={LEAD_PRIORITIES.map((value) => ({ value, label: LEAD_PRIORITY_LABELS[value] }))}
          />

          <SelectField
            label="Method"
            value={method}
            onChange={(event) => setMethod(event.target.value as ContactMethod | '')}
            options={[
              { value: '', label: 'Not specified' },
              ...CONTACT_METHODS.map((value) => ({ value, label: CONTACT_METHOD_LABELS[value] })),
            ]}
            hint={
              row.coverage.recommendedNextMethod === null
                ? undefined
                : `Suggested: ${CONTACT_METHOD_LABELS[row.coverage.recommendedNextMethod]} — ${row.coverage.recommendationReason.toLowerCase()}`
            }
          />
        </div>

        {row.openFollowUp !== null && (
          <CheckboxField
            label="Mark the current follow-up as completed"
            hint="Leave unticked to record it as replaced instead. Either way it stays in history."
            checked={completeCurrent}
            onChange={setCompleteCurrent}
          />
        )}

        {resolved !== null && (
          <p className="text-xs text-slate-400">
            {`Due ${formatDateTime(resolved.toISOString(), settings.timeZone)}.`}
          </p>
        )}

        {error !== null && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
