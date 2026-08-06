import { useMemo, useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { CheckboxField, SelectField, TextAreaField, TextField } from '../../components/ui/Field.tsx'
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_OUTCOME_LABELS,
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  CONTACT_METHODS,
  CONTACT_METHOD_LABELS,
  directionForActivityType,
  methodForActivityType,
} from '../../domain/vocabulary.ts'
import type { ActivityOutcome, ActivityType, ContactMethod } from '../../domain/vocabulary.ts'
import type { ActivityDraft, FollowUpPlan } from '../../data/workspace.ts'
import type { UserSettings } from '../../domain/settings.ts'
import {
  defaultWaitingDeadline,
  parseLocalDateTimeInput,
  resolvePreset,
  suggestFollowUp,
  toLocalDateTimeInput,
  type FollowUpPreset,
} from '../../domain/follow-up-presets.ts'
import { formatDateTime } from '../../lib/format.ts'
import type { CustomerRow } from '../../domain/dashboard.ts'

/**
 * The six choices the brief asks for after recording an activity, plus the
 * plain save. Each maps onto a FollowUpPlan the repository applies atomically
 * with respect to the one-open-follow-up rule.
 */
const PLAN_CHOICES = [
  { value: 'save_only', label: 'Save only' },
  { value: 'schedule', label: 'Save and schedule next follow-up' },
  { value: 'waiting', label: 'Save and mark waiting for customer' },
  { value: 'complete', label: 'Save and complete current follow-up' },
  { value: 'complete_and_schedule', label: 'Save, complete current and create next' },
  { value: 'close', label: 'Save and close customer' },
] as const
type PlanChoice = (typeof PLAN_CHOICES)[number]['value']

const PRESET_CHOICES: Array<{ value: FollowUpPreset; label: string }> = [
  { value: 'later_today', label: 'Later today' },
  { value: 'tomorrow_morning', label: 'Tomorrow morning' },
  { value: 'tomorrow_afternoon', label: 'Tomorrow afternoon' },
  { value: 'in_two_days', label: 'In two days' },
  { value: 'in_three_days', label: 'In three days' },
  { value: 'next_week', label: 'Next week' },
  { value: 'custom', label: 'Custom date and time' },
]

const CLOSE_CHOICES = [
  { value: 'sold', label: 'Sold' },
  { value: 'lost', label: 'Lost' },
  { value: 'do_not_contact', label: 'Do not contact' },
  { value: 'archived', label: 'Archived' },
] as const

export interface ActivityDialogResult {
  draft: ActivityDraft
  plan: FollowUpPlan
  /** Short human summary for the confirmation toast. */
  summary: string
}

export function ActivityDialog({
  open,
  row,
  settings,
  initialType = 'outbound_call',
  onSubmit,
  onClose,
}: {
  open: boolean
  row: CustomerRow
  settings: UserSettings
  initialType?: ActivityType
  onSubmit: (result: ActivityDialogResult) => Promise<void>
  onClose: () => void
}) {
  const now = useMemo(() => new Date(), [])

  const [type, setType] = useState<ActivityType>(initialType)
  const [outcome, setOutcome] = useState<ActivityOutcome | ''>('')
  const [method, setMethod] = useState<ContactMethod | ''>(methodForActivityType(initialType) ?? '')
  const [summary, setSummary] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => toLocalDateTimeInput(now, settings.timeZone))
  const [performedByUser, setPerformedByUser] = useState(true)

  const [planChoice, setPlanChoice] = useState<PlanChoice>('save_only')
  const [preset, setPreset] = useState<FollowUpPreset>('tomorrow_morning')
  const [customDueAt, setCustomDueAt] = useState('')
  const [reason, setReason] = useState('')
  const [waitingUntil, setWaitingUntil] = useState(() =>
    toLocalDateTimeInput(defaultWaitingDeadline(settings, now), settings.timeZone),
  )
  const [closeStatus, setCloseStatus] = useState<(typeof CLOSE_CHOICES)[number]['value']>('sold')
  const [isAppointment, setIsAppointment] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const direction = directionForActivityType(type)
  const suggestion = useMemo(
    () => suggestFollowUp(type, outcome === '' ? null : outcome, settings, now),
    [type, outcome, settings, now],
  )

  // Internal activity can never be a personal attempt: the database rejects it.
  const canBePersonalAttempt = direction !== 'internal'

  function applyType(nextType: ActivityType) {
    setType(nextType)
    setMethod(methodForActivityType(nextType) ?? '')
    if (directionForActivityType(nextType) === 'internal') setPerformedByUser(false)
  }

  function resolveDueAt(): Date | null {
    if (preset === 'custom') return parseLocalDateTimeInput(customDueAt, settings.timeZone)
    return resolvePreset(preset, settings, now)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const occurred = parseLocalDateTimeInput(occurredAt, settings.timeZone)
    if (occurred === null) {
      setError('Enter a valid date and time for the activity.')
      return
    }

    const draft: ActivityDraft = {
      customerId: row.customer.id,
      type,
      direction,
      method: method === '' ? null : method,
      outcome: outcome === '' ? null : outcome,
      summary: summary.trim() === '' ? null : summary.trim(),
      occurredAt: occurred.toISOString(),
      source: 'manual',
      performedByUser: canBePersonalAttempt && performedByUser,
    }

    const plan = buildPlan()
    if (plan === null) return

    setSubmitting(true)
    try {
      await onSubmit({ draft, plan, summary: describe(type, plan) })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the activity.')
    } finally {
      setSubmitting(false)
    }
  }

  function buildPlan(): FollowUpPlan | null {
    switch (planChoice) {
      case 'save_only':
        return { kind: 'none' }

      case 'complete':
        return { kind: 'complete', note: 'Completed when logging activity' }

      case 'close':
        return { kind: 'close', leadStatus: closeStatus }

      case 'waiting': {
        const until = parseLocalDateTimeInput(waitingUntil, settings.timeZone)
        if (until === null) {
          setError('Enter a valid response deadline.')
          return null
        }
        return {
          kind: 'waiting',
          waitingUntil: until.toISOString(),
          reason: reason.trim() === '' ? null : reason.trim(),
          resolution: 'complete',
        }
      }

      case 'schedule':
      case 'complete_and_schedule': {
        const dueAt = resolveDueAt()
        if (dueAt === null) {
          setError('Choose when the next follow-up is due.')
          return null
        }
        return {
          kind: 'schedule',
          dueAt: dueAt.toISOString(),
          reason: reason.trim() === '' ? (suggestion?.reason ?? null) : reason.trim(),
          recommendedMethod: suggestion?.recommendedMethod ?? null,
          isAppointment,
          // "Complete and create next" records the old one as done; a plain
          // reschedule records it as replaced. Either way it is never dropped.
          resolution: planChoice === 'complete_and_schedule' ? 'complete' : 'reschedule',
        }
      }
    }
  }

  const showScheduleFields = planChoice === 'schedule' || planChoice === 'complete_and_schedule'
  const previewDueAt = showScheduleFields ? resolveDueAt() : null

  return (
    <Modal
      open={open}
      title={`Log activity — ${row.customer.fullName}`}
      description="Recording what happened, and deciding what happens next."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="activity-form" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save activity'}
          </Button>
        </>
      }
    >
      <form id="activity-form" onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Activity type"
            value={type}
            onChange={(event) => applyType(event.target.value as ActivityType)}
            options={ACTIVITY_TYPES.map((value) => ({ value, label: ACTIVITY_TYPE_LABELS[value] }))}
          />

          <SelectField
            label="Outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as ActivityOutcome | '')}
            options={[
              { value: '', label: 'Not recorded' },
              ...ACTIVITY_OUTCOMES.map((value) => ({ value, label: ACTIVITY_OUTCOME_LABELS[value] })),
            ]}
          />

          <SelectField
            label="Channel"
            value={method}
            onChange={(event) => setMethod(event.target.value as ContactMethod | '')}
            options={[
              { value: '', label: 'Not applicable' },
              ...CONTACT_METHODS.map((value) => ({ value, label: CONTACT_METHOD_LABELS[value] })),
            ]}
            hint="Only channels on attempts I made count towards coverage."
          />

          <TextField
            label="When"
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            required
          />
        </div>

        <TextAreaField
          label="Summary"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="What was said, what was promised."
        />

        <CheckboxField
          label="I made this contact personally"
          hint={
            canBePersonalAttempt
              ? 'Leave unticked for activity that only appears in the CRM. It will not count as an attempt by me.'
              : 'Internal activity is never a personal contact attempt.'
          }
          checked={canBePersonalAttempt && performedByUser}
          disabled={!canBePersonalAttempt}
          onChange={setPerformedByUser}
        />

        <fieldset className="space-y-3 rounded-lg border border-slate-800 p-4">
          <legend className="px-1 text-sm font-medium text-slate-300">Then what?</legend>

          <SelectField
            label="Next action"
            value={planChoice}
            onChange={(event) => setPlanChoice(event.target.value as PlanChoice)}
            options={PLAN_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
          />

          {suggestion !== null && showScheduleFields && (
            <p className="text-xs text-sky-300">
              {`Suggested: ${suggestion.reason.toLowerCase()}.`}
            </p>
          )}

          {showScheduleFields && (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="When"
                value={preset}
                onChange={(event) => setPreset(event.target.value as FollowUpPreset)}
                options={PRESET_CHOICES}
              />

              {preset === 'custom' && (
                <TextField
                  label="Custom date and time"
                  type="datetime-local"
                  value={customDueAt}
                  onChange={(event) => setCustomDueAt(event.target.value)}
                />
              )}

              <TextField
                label="Reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={suggestion?.reason ?? 'Why this follow-up exists'}
              />

              <div className="sm:col-span-2">
                <CheckboxField
                  label="This is an appointment"
                  hint="Appointments appear in their own dashboard queue."
                  checked={isAppointment}
                  onChange={setIsAppointment}
                />
              </div>

              {previewDueAt !== null && (
                <p className="text-xs text-slate-400 sm:col-span-2">
                  {`Next follow-up will be due ${formatDateTime(previewDueAt.toISOString(), settings.timeZone)}.`}
                </p>
              )}
            </div>
          )}

          {planChoice === 'waiting' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Response deadline"
                type="datetime-local"
                value={waitingUntil}
                onChange={(event) => setWaitingUntil(event.target.value)}
                hint="Waiting always has an end. If nothing arrives, this returns to Action required."
              />
              <TextField
                label="Waiting for what?"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Payoff amount, financing decision…"
              />
            </div>
          )}

          {planChoice === 'close' && (
            <SelectField
              label="Close as"
              value={closeStatus}
              onChange={(event) =>
                setCloseStatus(event.target.value as (typeof CLOSE_CHOICES)[number]['value'])
              }
              options={CLOSE_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
            />
          )}
        </fieldset>

        {error !== null && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

function describe(type: ActivityType, plan: FollowUpPlan): string {
  const label = ACTIVITY_TYPE_LABELS[type].toLowerCase()

  switch (plan.kind) {
    case 'none':
      return `Logged ${label}`
    case 'complete':
      return `Logged ${label} and completed the follow-up`
    case 'schedule':
      return `Logged ${label} and scheduled the next follow-up`
    case 'waiting':
      return `Logged ${label} and marked waiting for the customer`
    case 'close':
      return `Logged ${label} and closed the customer as ${plan.leadStatus.replace(/_/g, ' ')}`
  }
}
