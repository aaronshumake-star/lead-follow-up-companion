import { useMemo } from 'react'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle, StatTile } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { DEMO_CUSTOMERS, followUpsForCustomer } from '../../data/fixtures.ts'
import { resolveNextAction, sortByUrgency, summarizeQueue } from '../../domain/next-action.ts'
import { LEAD_STATUS_LABELS } from '../../domain/vocabulary.ts'
import { formatRelative } from '../../lib/format.ts'

/**
 * The dashboard exists to answer one question: what am I about to forget?
 *
 * Phase 1 renders it from fixtures rather than from live queries, but the
 * queue logic is the real thing — resolveNextAction and summarizeQueue are the
 * same functions the live version will use, and they mirror the
 * customer_next_action view.
 */
export function DashboardPage() {
  const actions = useMemo(
    () =>
      sortByUrgency(
        DEMO_CUSTOMERS.map((customer) =>
          resolveNextAction(customer, followUpsForCustomer(customer.id)),
        ),
      ),
    [],
  )

  const counts = useMemo(() => summarizeQueue(actions), [actions])
  const customersById = useMemo(
    () => new Map(DEMO_CUSTOMERS.map((customer) => [customer.id, customer])),
    [],
  )

  const noNextAction = actions.filter((action) => !action.hasNextAction)
  const upcoming = actions.filter((action) => action.hasNextAction && action.dueAt !== null)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Every active customer should have a next action. The ones that do not are listed first."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="No next action"
          value={counts.noNextAction}
          tone={counts.noNextAction > 0 ? 'alert' : 'good'}
          hint="Active with nothing scheduled"
        />
        <StatTile label="Overdue" value={counts.overdue} tone={counts.overdue > 0 ? 'warn' : 'good'} />
        <StatTile label="Due today" value={counts.dueToday} />
        <StatTile label="Waiting on customer" value={counts.waitingOnCustomer} />
        <StatTile label="Closed" value={counts.closed} hint="Sold, lost, archived" />
      </div>

      <Card className={noNextAction.length > 0 ? 'border-rose-900/70' : undefined}>
        <CardTitle hint="An active customer with no follow-up, no appointment and no waiting deadline.">
          No next action
        </CardTitle>

        {noNextAction.length === 0 ? (
          <p className="text-sm text-emerald-300">
            Nothing forgotten. Every active customer has a next action.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {noNextAction.map((action) => {
              const customer = customersById.get(action.customerId)
              if (customer === undefined) return null

              return (
                <li key={action.customerId} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="font-medium text-slate-100">{customer.fullName}</span>
                  <Badge tone="alert">Needs a next action</Badge>
                  <Badge>{LEAD_STATUS_LABELS[customer.leadStatus]}</Badge>
                  <span className="text-sm text-slate-500">
                    Last activity {formatRelative(customer.lastActivityAt)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle hint="Ordered by when each commitment comes due.">Scheduled work</CardTitle>
        <ul className="divide-y divide-slate-800">
          {upcoming.map((action) => {
            const customer = customersById.get(action.customerId)
            if (customer === undefined) return null

            return (
              <li key={action.customerId} className="flex flex-wrap items-center gap-3 py-3">
                <span className="font-medium text-slate-100">{customer.fullName}</span>
                <Badge tone={action.isOverdue ? 'warn' : 'info'}>
                  {action.isOverdue ? 'Overdue' : 'Scheduled'}
                </Badge>
                <span className="text-sm text-slate-400">{action.reason}</span>
                <span className="ml-auto text-sm text-slate-500">{formatRelative(action.dueAt)}</span>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
