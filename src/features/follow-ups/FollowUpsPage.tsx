import { useMemo } from 'react'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { PhaseNotice } from '../../components/ui/PhaseNotice.tsx'
import { DEMO_CUSTOMERS, DEMO_FOLLOW_UPS } from '../../data/fixtures.ts'
import { effectiveDueAt } from '../../domain/next-action.ts'
import {
  CONTACT_METHOD_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  LEAD_PRIORITY_LABELS,
  isOpenFollowUpStatus,
} from '../../domain/vocabulary.ts'
import { formatDateTime, formatRelative } from '../../lib/format.ts'
import type { FollowUpStatus } from '../../domain/vocabulary.ts'
import type { BadgeTone } from '../../components/ui/Badge.tsx'

const STATUS_TONES: Record<FollowUpStatus, BadgeTone> = {
  pending: 'info',
  snoozed: 'neutral',
  completed: 'good',
  canceled: 'neutral',
  overdue: 'alert',
  waiting_on_customer: 'warn',
}

export function FollowUpsPage() {
  const customersById = useMemo(
    () => new Map(DEMO_CUSTOMERS.map((customer) => [customer.id, customer])),
    [],
  )

  const rows = useMemo(
    () =>
      [...DEMO_FOLLOW_UPS].sort((a, b) => {
        // Open commitments first, then by when they actually surface.
        const aOpen = isOpenFollowUpStatus(a.status)
        const bOpen = isOpenFollowUpStatus(b.status)
        if (aOpen !== bOpen) return aOpen ? -1 : 1
        return effectiveDueAt(a) < effectiveDueAt(b) ? -1 : 1
      }),
    [],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-Ups"
        description="One open follow-up per customer, enforced by the database rather than by convention."
      />

      <PhaseNotice
        phase="Phase 1"
        summary="Read-only preview of the follow-up queue."
        planned={[
          'Schedule, snooze, complete and cancel follow-ups',
          'Waiting-for-customer deadlines that convert into a reminder when they elapse',
          'Reminder scheduling with a per-message idempotency key',
          'Bulk actions from the overdue list',
        ]}
      />

      <Card>
        <CardTitle hint="Snoozed and waiting rows show the moment they come back.">
          {`${rows.length} follow-ups`}
        </CardTitle>

        <ul className="divide-y divide-slate-800">
          {rows.map((followUp) => {
            const customer = customersById.get(followUp.customerId)
            const dueAt = effectiveDueAt(followUp)

            return (
              <li key={followUp.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-48">
                  <p className="font-medium text-slate-100">{customer?.fullName ?? 'Unknown customer'}</p>
                  <p className="text-xs text-slate-500">{followUp.reason ?? 'No reason recorded'}</p>
                </div>

                <Badge tone={STATUS_TONES[followUp.status]}>
                  {FOLLOW_UP_STATUS_LABELS[followUp.status]}
                </Badge>
                <Badge>{LEAD_PRIORITY_LABELS[followUp.priority]}</Badge>
                {followUp.recommendedMethod !== null && (
                  <Badge tone="info">
                    {`via ${CONTACT_METHOD_LABELS[followUp.recommendedMethod]}`}
                  </Badge>
                )}

                <div className="ml-auto text-right">
                  <p className="text-sm text-slate-300">{formatDateTime(dueAt)}</p>
                  <p className="text-xs text-slate-500">{formatRelative(dueAt)}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
