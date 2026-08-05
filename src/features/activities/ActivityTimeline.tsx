import { useState } from 'react'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { EmptyState } from '../../components/ui/States.tsx'
import { Modal } from '../../components/ui/Modal.tsx'
import { SelectField, TextAreaField, TextField, CheckboxField } from '../../components/ui/Field.tsx'
import {
  ACTIVITY_DIRECTION_LABELS,
  ACTIVITY_OUTCOMES,
  ACTIVITY_OUTCOME_LABELS,
  ACTIVITY_TYPE_LABELS,
  CONTACT_METHOD_LABELS,
  RECORD_SOURCE_LABELS,
  directionForActivityType,
} from '../../domain/vocabulary.ts'
import type { ActivityOutcome } from '../../domain/vocabulary.ts'
import type { Activity, AuditEntry } from '../../domain/models.ts'
import type { ActivityPatch } from '../../data/workspace.ts'
import { formatDateTime, formatRelative } from '../../lib/format.ts'
import { parseLocalDateTimeInput, toLocalDateTimeInput } from '../../domain/follow-up-presets.ts'

/**
 * The customer's communication ledger.
 *
 * Two things are always visible per row: where the record came from, and
 * whether it was a contact *I* made. Without that second marker, a CRM-imported
 * automated email reads exactly like a call you placed yourself.
 *
 * Rows can be corrected but never deleted, and a correction leaves an audit
 * entry that this timeline surfaces.
 */
export function ActivityTimeline({
  activities,
  auditEntries,
  timeZone,
  onEdit,
}: {
  activities: readonly Activity[]
  auditEntries: readonly AuditEntry[]
  timeZone: string
  onEdit: (activityId: string, patch: ActivityPatch, reason: string | null) => Promise<void>
}) {
  const [editing, setEditing] = useState<Activity | null>(null)

  const editedIds = new Set(
    auditEntries
      .filter((entry) => entry.tableName === 'activities' && entry.recordId !== null)
      .map((entry) => entry.recordId as string),
  )

  if (activities.length === 0) {
    return (
      <EmptyState
        title="Nothing recorded yet"
        description="Use a quick action or Add activity to start the timeline."
      />
    )
  }

  return (
    <>
      <ol className="space-y-3">
        {activities.map((activity) => (
          <li
            key={activity.id}
            className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-100">{ACTIVITY_TYPE_LABELS[activity.type]}</span>
              <Badge>{ACTIVITY_DIRECTION_LABELS[activity.direction]}</Badge>
              {activity.outcome !== null && (
                <Badge tone={toneForOutcome(activity.outcome)}>
                  {ACTIVITY_OUTCOME_LABELS[activity.outcome]}
                </Badge>
              )}
              {activity.method !== null && <Badge>{CONTACT_METHOD_LABELS[activity.method]}</Badge>}

              {/* The distinction the coverage maths depends on. */}
              {activity.performedByUser ? (
                <Badge tone="good">Attempted by me</Badge>
              ) : (
                <Badge tone="neutral">Not my attempt</Badge>
              )}

              <Badge>{RECORD_SOURCE_LABELS[activity.source]}</Badge>
              {editedIds.has(activity.id) && <Badge tone="warn">Edited</Badge>}

              <span className="ml-auto text-xs text-slate-500">
                {formatRelative(activity.occurredAt)}
              </span>
            </div>

            {activity.summary !== null && (
              <p className="mt-1.5 text-sm text-slate-300">{activity.summary}</p>
            )}

            <div className="mt-1.5 flex items-center gap-3">
              <span className="text-xs text-slate-500">
                {formatDateTime(activity.occurredAt, timeZone)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(activity)}>
                Correct
              </Button>
            </div>
          </li>
        ))}
      </ol>

      {editing !== null && (
        <EditActivityDialog
          activity={editing}
          timeZone={timeZone}
          onClose={() => setEditing(null)}
          onSubmit={onEdit}
        />
      )}
    </>
  )
}

function EditActivityDialog({
  activity,
  timeZone,
  onClose,
  onSubmit,
}: {
  activity: Activity
  timeZone: string
  onClose: () => void
  onSubmit: (activityId: string, patch: ActivityPatch, reason: string | null) => Promise<void>
}) {
  const [outcome, setOutcome] = useState<ActivityOutcome | ''>(activity.outcome ?? '')
  const [summary, setSummary] = useState(activity.summary ?? '')
  const [occurredAt, setOccurredAt] = useState(() => toLocalDateTimeInput(new Date(activity.occurredAt), timeZone))
  const [performedByUser, setPerformedByUser] = useState(activity.performedByUser)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const canBePersonalAttempt = directionForActivityType(activity.type, activity.direction) !== 'internal'

  async function submit() {
    setError(null)
    const occurred = parseLocalDateTimeInput(occurredAt, timeZone)
    if (occurred === null) {
      setError('Enter a valid date and time.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(
        activity.id,
        {
          outcome: outcome === '' ? null : outcome,
          summary: summary.trim() === '' ? null : summary.trim(),
          occurredAt: occurred.toISOString(),
          performedByUser: canBePersonalAttempt && performedByUser,
        },
        reason.trim() === '' ? null : reason.trim(),
      )
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the correction.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title="Correct activity"
      description="The original values are kept in the audit log along with your reason."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={submitting} onClick={() => void submit()}>
            {submitting ? 'Saving…' : 'Save correction'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as ActivityOutcome | '')}
          options={[
            { value: '', label: 'Not recorded' },
            ...ACTIVITY_OUTCOMES.map((value) => ({ value, label: ACTIVITY_OUTCOME_LABELS[value] })),
          ]}
        />

        <TextField
          label="When"
          type="datetime-local"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
        />

        <TextAreaField
          label="Summary"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />

        <CheckboxField
          label="I made this contact personally"
          hint={
            canBePersonalAttempt
              ? 'Untick for activity that only appears in the CRM.'
              : 'Internal activity is never a personal contact attempt.'
          }
          checked={canBePersonalAttempt && performedByUser}
          disabled={!canBePersonalAttempt}
          onChange={setPerformedByUser}
        />

        <TextField
          label="Reason for the correction"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Logged the wrong outcome"
          hint="Optional, but it is what makes the audit entry useful later."
        />

        {error !== null && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

function toneForOutcome(outcome: ActivityOutcome): 'good' | 'warn' | 'neutral' {
  if (['connected', 'replied', 'appointment_set', 'appointment_kept', 'sold'].includes(outcome)) {
    return 'good'
  }
  if (['no_answer', 'no_reply', 'busy', 'appointment_missed'].includes(outcome)) return 'warn'
  return 'neutral'
}
