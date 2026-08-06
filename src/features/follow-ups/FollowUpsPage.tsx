import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Badge, type BadgeTone } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States.tsx'
import { useToast } from '../../components/ui/useToast.ts'
import { useWorkspace } from '../../data/useWorkspace.ts'
import { effectiveDueAt } from '../../domain/next-action.ts'
import {
  CONTACT_METHOD_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  LEAD_PRIORITY_LABELS,
  isOpenFollowUpStatus,
} from '../../domain/vocabulary.ts'
import type { FollowUpStatus } from '../../domain/vocabulary.ts'
import { formatDateTime, formatRelative } from '../../lib/format.ts'
import { FollowUpDialog, type FollowUpDialogMode } from './FollowUpDialog.tsx'
import type { CustomerRow } from '../../domain/dashboard.ts'

const STATUS_TONES: Record<FollowUpStatus, BadgeTone> = {
  pending: 'info',
  snoozed: 'neutral',
  completed: 'good',
  canceled: 'neutral',
  overdue: 'alert',
  waiting_on_customer: 'warn',
}

type Scope = 'open' | 'all'

export function FollowUpsPage() {
  const { status, error, rows, snapshot, settings, run, refresh } = useWorkspace()
  const { notify } = useToast()

  const [scope, setScope] = useState<Scope>('open')
  const [dialog, setDialog] = useState<{ mode: FollowUpDialogMode; row: CustomerRow } | null>(null)

  const rowsByCustomer = useMemo(
    () => new Map(rows.map((row) => [row.customer.id, row])),
    [rows],
  )

  const followUps = useMemo(() => {
    const all = snapshot?.followUps ?? []
    const filtered = scope === 'open' ? all.filter((item) => isOpenFollowUpStatus(item.status)) : all

    return [...filtered].sort((a, b) => {
      const aOpen = isOpenFollowUpStatus(a.status)
      const bOpen = isOpenFollowUpStatus(b.status)
      if (aOpen !== bOpen) return aOpen ? -1 : 1
      return effectiveDueAt(a) < effectiveDueAt(b) ? -1 : 1
    })
  }, [snapshot, scope])

  if (status === 'loading') return <LoadingState label="Loading follow-ups…" />
  if (status === 'error') {
    return <ErrorState message={error ?? 'Could not load follow-ups.'} onRetry={() => void refresh()} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-Ups"
        description="One open follow-up per customer, enforced by a database index rather than by convention."
        actions={
          <Button variant="secondary" onClick={() => setScope(scope === 'open' ? 'all' : 'open')}>
            {scope === 'open' ? 'Show history too' : 'Show open only'}
          </Button>
        }
      />

      <Card>
        <CardTitle hint="Snoozed and waiting rows show the moment they come back.">
          {`${followUps.length} ${scope === 'open' ? 'open' : 'total'} follow-up${followUps.length === 1 ? '' : 's'}`}
        </CardTitle>

        {followUps.length === 0 ? (
          <EmptyState
            title={scope === 'open' ? 'No open follow-ups' : 'No follow-ups yet'}
            description="Customers without one appear in the no-next-action queue on the dashboard."
          />
        ) : (
          <ul className="divide-y divide-slate-800">
            {followUps.map((followUp) => {
              const row = rowsByCustomer.get(followUp.customerId)
              const dueAt = effectiveDueAt(followUp)
              const open = isOpenFollowUpStatus(followUp.status)
              const overdue = open && new Date(dueAt).getTime() <= Date.now()

              return (
                <li key={followUp.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-52">
                    {row === undefined ? (
                      <span className="font-medium text-slate-400">Unknown customer</span>
                    ) : (
                      <Link
                        to={`/customers/${row.customer.id}`}
                        className="font-medium text-slate-100 hover:underline"
                      >
                        {row.customer.fullName}
                      </Link>
                    )}
                    <p className="text-xs text-slate-500">
                      {followUp.reason ?? followUp.outcomeNote ?? 'No reason recorded'}
                    </p>
                  </div>

                  <Badge tone={overdue ? 'alert' : STATUS_TONES[followUp.status]}>
                    {overdue ? 'Overdue' : FOLLOW_UP_STATUS_LABELS[followUp.status]}
                  </Badge>
                  <Badge>{LEAD_PRIORITY_LABELS[followUp.priority]}</Badge>
                  {followUp.isAppointment && <Badge tone="good">Appointment</Badge>}
                  {followUp.recommendedMethod !== null && (
                    <Badge tone="info">
                      {`via ${CONTACT_METHOD_LABELS[followUp.recommendedMethod]}`}
                    </Badge>
                  )}

                  <div className="ml-auto text-right">
                    <p className="text-sm text-slate-300">{formatDateTime(dueAt, settings.timeZone)}</p>
                    <p className="text-xs text-slate-500">{formatRelative(dueAt)}</p>
                  </div>

                  {open && row !== undefined && (
                    <div className="flex w-full flex-wrap gap-1.5 sm:w-auto">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          void run((repository) => repository.completeFollowUp(row.customer.id)).then(
                            () => notify('success', `Follow-up completed for ${row.customer.fullName}.`),
                          )
                        }
                      >
                        Complete
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setDialog({ mode: 'snooze', row })}>
                        Snooze
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDialog({ mode: 'reschedule', row })}
                      >
                        Reschedule
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {dialog !== null && (
        <FollowUpDialog
          open
          mode={dialog.mode}
          row={dialog.row}
          settings={settings}
          onClose={() => setDialog(null)}
          onSubmit={async ({ mode, input, summary }) => {
            if (mode === 'snooze' && dialog.row.openFollowUp !== null) {
              await run((repository) =>
                repository.snoozeFollowUp(dialog.row.openFollowUp!.id, input.dueAt),
              )
            } else {
              await run((repository) => repository.scheduleFollowUp(input))
            }
            notify('success', summary)
          }}
        />
      )}
    </div>
  )
}
