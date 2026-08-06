import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/ui/Button.tsx'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx'
import { useToast } from '../../components/ui/useToast.ts'
import { useWorkspace } from '../../data/useWorkspace.ts'
import type { CustomerRow } from '../../domain/dashboard.ts'
import type { ActivityDraft, FollowUpPlan } from '../../data/workspace.ts'
import { suggestFollowUp } from '../../domain/follow-up-presets.ts'
import type { ActivityOutcome, ActivityType, LeadStatus } from '../../domain/vocabulary.ts'
import { ActivityDialog } from '../activities/ActivityDialog.tsx'
import { FollowUpDialog, type FollowUpDialogMode } from '../follow-ups/FollowUpDialog.tsx'
import { formatDateTime } from '../../lib/format.ts'

/**
 * One-click logging with a sensible next action already chosen.
 *
 * Each quick action records the activity *and* schedules the follow-up its
 * outcome implies, so the common case is a single click. The toast says what
 * was scheduled and offers "Change" for the cases where the default is wrong —
 * cheaper than making every call a two-step dialog.
 */
interface QuickAction {
  id: string
  label: string
  type: ActivityType
  outcome: ActivityOutcome | null
  /** Whether this represents contact I personally made. */
  performedByUser: boolean
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'call-answered', label: 'Called — answered', type: 'outbound_call', outcome: 'connected', performedByUser: true },
  { id: 'call-no-answer', label: 'Called — no answer', type: 'outbound_call', outcome: 'no_answer', performedByUser: true },
  { id: 'voicemail', label: 'Left voicemail', type: 'voicemail_left', outcome: 'left_voicemail', performedByUser: true },
  { id: 'text', label: 'Sent text', type: 'outbound_text', outcome: 'no_reply', performedByUser: true },
  { id: 'email', label: 'Sent email', type: 'outbound_email', outcome: 'no_reply', performedByUser: true },
  // Inbound: the customer acted, not me, so this is not a personal attempt.
  { id: 'replied', label: 'Customer replied', type: 'inbound_text', outcome: 'replied', performedByUser: false },
]

export function CustomerActions({
  row,
  variant = 'compact',
}: {
  row: CustomerRow
  variant?: 'compact' | 'full'
}) {
  const { run, settings } = useWorkspace()
  const { notify } = useToast()
  const navigate = useNavigate()

  const [activityOpen, setActivityOpen] = useState(false)
  const [activityType, setActivityType] = useState<ActivityType>('outbound_call')
  const [followUpMode, setFollowUpMode] = useState<FollowUpDialogMode | null>(null)
  const [confirming, setConfirming] = useState<null | {
    title: string
    message: string
    confirmLabel: string
    onConfirm: () => Promise<void>
  }>(null)

  const busy = false

  async function runQuick(action: QuickAction) {
    const now = new Date()
    const suggestion = suggestFollowUp(action.type, action.outcome, settings, now)

    const draft: ActivityDraft = {
      customerId: row.customer.id,
      type: action.type,
      direction: action.type === 'inbound_text' ? 'inbound' : 'outbound',
      outcome: action.outcome,
      performedByUser: action.performedByUser,
      source: 'manual',
    }

    // Completing the current commitment and opening the next one happen in a
    // single repository call, so the one-open-follow-up rule is never violated.
    const plan: FollowUpPlan =
      suggestion === null
        ? { kind: 'complete', note: 'Completed by quick action' }
        : {
            kind: 'schedule',
            dueAt: suggestion.dueAt.toISOString(),
            reason: suggestion.reason,
            recommendedMethod: suggestion.recommendedMethod,
            isAppointment: suggestion.preset === 'appointment',
            resolution: 'complete',
          }

    try {
      await run((repository) => repository.logActivity(draft, plan))

      const scheduled =
        suggestion === null
          ? 'no follow-up scheduled'
          : `next follow-up ${formatDateTime(suggestion.dueAt.toISOString(), settings.timeZone)}`

      notify('success', `${action.label} · ${scheduled}`, {
        label: 'Change',
        onSelect: () => setFollowUpMode('reschedule'),
      })
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'Could not record that.')
    }
  }

  async function setStatus(status: LeadStatus, label: string) {
    try {
      await run((repository) => repository.setLeadStatus(row.customer.id, status))
      notify('success', `${row.customer.fullName} marked ${label}.`)
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'Could not change the status.')
    }
  }

  const compact = variant === 'compact'

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void runQuick(action)}
          >
            {action.label}
          </Button>
        ))}

        <Button size="sm" variant="secondary" onClick={() => setFollowUpMode('appointment')}>
          Appointment set
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setFollowUpMode('waiting')}>
          Waiting for customer
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setFollowUpMode('snooze')}>
          Snooze
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setFollowUpMode('reschedule')}>
          Reschedule
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setActivityType('note')
            setActivityOpen(true)
          }}
        >
          Add note
        </Button>

        {/* Sold is not destructive, but it is a decision worth confirming. */}
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setConfirming({
              title: 'Mark as sold',
              message: `Close ${row.customer.fullName} as sold? Any open follow-up will be closed.`,
              confirmLabel: 'Mark sold',
              onConfirm: () => setStatus('sold', 'sold'),
            })
          }
        >
          Mark sold
        </Button>

        <Button
          size="sm"
          variant="danger"
          onClick={() =>
            setConfirming({
              title: 'Mark as lost',
              message: `Close ${row.customer.fullName} as lost? They will drop out of the active queues and any open follow-up will be canceled.`,
              confirmLabel: 'Mark lost',
              onConfirm: () => setStatus('lost', 'lost'),
            })
          }
        >
          Mark lost
        </Button>

        {compact && (
          <Button size="sm" variant="ghost" onClick={() => void navigate(`/customers/${row.customer.id}`)}>
            Open customer
          </Button>
        )}

        {!compact && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setActivityOpen(true)}>
              Add activity
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setFollowUpMode('schedule')}>
              Add follow-up
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                setConfirming({
                  title: 'Archive customer',
                  message: `Archive ${row.customer.fullName}? They will be hidden from the working queues but can be restored later.`,
                  confirmLabel: 'Archive',
                  onConfirm: async () => {
                    await run((repository) => repository.archiveCustomer(row.customer.id))
                    notify('success', `${row.customer.fullName} archived.`)
                  },
                })
              }
            >
              Archive
            </Button>
          </>
        )}
      </div>

      {activityOpen && (
        <ActivityDialog
          open
          row={row}
          settings={settings}
          initialType={activityType}
          onClose={() => setActivityOpen(false)}
          onSubmit={async ({ draft, plan, summary }) => {
            await run((repository) => repository.logActivity(draft, plan))
            notify('success', summary)
          }}
        />
      )}

      {followUpMode !== null && (
        <FollowUpDialog
          open
          mode={followUpMode}
          row={row}
          settings={settings}
          onClose={() => setFollowUpMode(null)}
          onSubmit={async ({ mode, input, summary }) => {
            // Snoozing keeps the same follow-up rather than replacing it, so its
            // history and reason survive.
            if (mode === 'snooze' && row.openFollowUp !== null) {
              await run((repository) =>
                repository.snoozeFollowUp(row.openFollowUp!.id, input.dueAt),
              )
            } else {
              await run((repository) => repository.scheduleFollowUp(input))
            }
            notify('success', summary)
          }}
        />
      )}

      {confirming !== null && (
        <ConfirmDialog
          open
          title={confirming.title}
          message={confirming.message}
          confirmLabel={confirming.confirmLabel}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const action = confirming.onConfirm
            setConfirming(null)
            void action()
          }}
        />
      )}
    </>
  )
}
