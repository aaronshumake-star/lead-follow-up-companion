import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle, StatTile } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States.tsx'
import { CustomerCard } from '../customers/CustomerCard.tsx'
import { useWorkspace } from '../../data/useWorkspace.ts'
import type { CustomerRow } from '../../domain/dashboard.ts'
import { formatDateTime, formatRelative } from '../../lib/format.ts'
import { CONTACT_METHOD_LABELS } from '../../domain/vocabulary.ts'

/**
 * The daily working surface.
 *
 * Ordered by what will hurt if it is missed: leads with no next action first,
 * because a forgotten lead is a process failure, then overdue work, then what
 * is merely scheduled.
 *
 * Nothing here filters by "today" in a way that could let an overdue lead drop
 * out of sight when the calendar rolls over. A follow-up leaves these queues
 * only by being completed, rescheduled, canceled, or by the customer being
 * closed.
 */
export function DashboardPage() {
  const { status, error, dashboard, settings, refresh } = useWorkspace()

  if (status === 'loading') return <LoadingState label="Loading your customers…" />
  if (status === 'error' || dashboard === null) {
    return <ErrorState message={error ?? 'Could not load your customers.'} onRetry={() => void refresh()} />
  }

  const { counts } = dashboard

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Every active customer should have a next action. The ones that do not come first."
        actions={
          <Button variant="primary" size="sm" onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />

      {/* Eight across on a desktop viewport, folding to four and then two so
          nothing ever needs horizontal scrolling. */}
      <div
        aria-label="Queue summary"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8"
      >
        <StatTile
          label="Action Required Now"
          value={counts.actionRequired}
          tone={counts.actionRequired > 0 ? 'alert' : 'good'}
          hint="Overdue or due within 2 hours"
        />
        <StatTile
          label="Overdue"
          value={counts.overdue}
          tone={counts.overdue > 0 ? 'warn' : 'good'}
          hint="Past due, still open"
        />
        <StatTile label="Due Today" value={counts.dueToday} hint="Still ahead of you today" />
        <StatTile label="Due Tomorrow" value={counts.dueTomorrow} hint="Tomorrow's commitments" />
        <StatTile
          label="Waiting for Customer"
          value={counts.waitingForCustomer}
          hint="Each with a deadline"
        />
        <StatTile
          label="No Next Action"
          value={counts.noNextAction}
          tone={counts.noNextAction > 0 ? 'alert' : 'good'}
          hint="Active, nothing scheduled"
        />
        <StatTile
          label="Upcoming Appointments"
          value={counts.upcomingAppointments}
          hint="Booked and ahead"
        />
        <StatTile
          label="Needs Review"
          value={counts.needsReview}
          tone={counts.needsReview > 0 ? 'warn' : 'good'}
          hint="Unworked or uncovered"
        />
      </div>

      <Queue
        id="no-next-action"
        title="No next action"
        hint="Active customers with no follow-up, no appointment and no waiting deadline."
        rows={dashboard.noNextAction}
        emptyTitle="Nothing forgotten"
        emptyDescription="Every active customer has a next action."
        tone="alert"
        timeZone={settings.timeZone}
      />

      <Queue
        id="action-required"
        title="Action required now"
        hint="Overdue work, follow-ups due within two hours, and waiting deadlines that have elapsed."
        rows={dashboard.actionRequired}
        emptyTitle="Nothing needs you right now"
        tone="alert"
        timeZone={settings.timeZone}
      />

      <Queue
        id="overdue"
        title="Overdue"
        hint="Most overdue first. These stay here until the action is completed, rescheduled, canceled or the customer is closed."
        rows={dashboard.overdue}
        emptyTitle="Nothing overdue"
        tone="warn"
        timeZone={settings.timeZone}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Queue
          id="due-today"
          title="Due today"
          hint="Still ahead of you today, earliest first."
          rows={dashboard.dueToday}
          emptyTitle="Nothing else due today"
          compact
          timeZone={settings.timeZone}
        />

        <Queue
          id="due-tomorrow"
          title="Due tomorrow"
          hint="Tomorrow's commitments, earliest first."
          rows={dashboard.dueTomorrow}
          emptyTitle="Nothing due tomorrow"
          compact
          timeZone={settings.timeZone}
        />
      </div>

      <WaitingQueue rows={dashboard.waitingForCustomer} timeZone={settings.timeZone} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle hint="Confirm these before the day arrives.">Upcoming appointments</CardTitle>
          {dashboard.upcomingAppointments.length === 0 ? (
            <EmptyState title="No appointments booked" />
          ) : (
            <ul className="divide-y divide-slate-800">
              {dashboard.upcomingAppointments.map((row) => (
                <li key={row.customer.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Link
                    to={`/customers/${row.customer.id}`}
                    className="font-medium text-slate-100 hover:underline"
                  >
                    {row.customer.fullName}
                  </Link>
                  <Badge tone="good">Appointment</Badge>
                  <span className="text-sm text-slate-400">{row.openFollowUp?.reason}</span>
                  <span className="ml-auto text-sm text-slate-300">
                    {formatDateTime(row.nextAction.dueAt, settings.timeZone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle hint="The newest records in the system.">Recently added</CardTitle>
          {dashboard.recentlyAdded.length === 0 ? (
            <EmptyState
              title="No customers yet"
              description="Add your first customer to start tracking follow-ups."
              action={
                <Link to="/customers?new=1">
                  <Button variant="primary">Add customer</Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-slate-800">
              {dashboard.recentlyAdded.map((row) => (
                <li key={row.customer.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Link
                    to={`/customers/${row.customer.id}`}
                    className="font-medium text-slate-100 hover:underline"
                  >
                    {row.customer.fullName}
                  </Link>
                  <span className="text-sm text-slate-500">{row.customer.leadSource ?? 'No source'}</span>
                  <span className="ml-auto text-sm text-slate-500">
                    {formatRelative(row.customer.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

/**
 * A queue collapses to a summary line past a handful of rows so the page stays
 * scannable in a few seconds, which is the whole point of the dashboard.
 */
function Queue({
  id,
  title,
  hint,
  rows,
  emptyTitle,
  emptyDescription,
  tone,
  compact = false,
  timeZone,
}: {
  id: string
  title: string
  hint: string
  rows: CustomerRow[]
  emptyTitle: string
  emptyDescription?: string
  tone?: 'alert' | 'warn'
  compact?: boolean
  timeZone: string
}) {
  const initial = compact ? 4 : 5
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? rows : rows.slice(0, initial)

  return (
    <Card
      className={
        rows.length > 0 && tone === 'alert'
          ? 'border-rose-900/70'
          : rows.length > 0 && tone === 'warn'
            ? 'border-amber-900/70'
            : undefined
      }
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2
            id={`queue-${id}`}
            className="text-sm font-semibold tracking-wide text-slate-200 uppercase"
          >
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{hint}</p>
        </div>
        <Badge tone={rows.length === 0 ? 'good' : (tone ?? 'info')}>{`${rows.length}`}</Badge>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <ul aria-labelledby={`queue-${id}`} className="space-y-3">
            {visible.map((row) => (
              <li key={row.customer.id}>
                <CustomerCard row={row} showActions={!compact} timeZone={timeZone} />
              </li>
            ))}
          </ul>

          {rows.length > initial && (
            <Button
              className="mt-3"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? 'Show fewer' : `Show all ${rows.length}`}
            </Button>
          )}
        </>
      )}
    </Card>
  )
}

/** Waiting needs its own columns: how long, by what, and when it comes back. */
function WaitingQueue({ rows, timeZone }: { rows: CustomerRow[]; timeZone: string }) {
  return (
    <Card>
      <CardTitle hint="Every waiting customer has a deadline. When it passes, they return to Action required.">
        Waiting for customer
      </CardTitle>

      {rows.length === 0 ? (
        <EmptyState title="Nobody is being waited on" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs tracking-wide text-slate-400 uppercase">
                <Th>Customer</Th>
                <Th>Last outbound</Th>
                <Th>Method used</Th>
                <Th>Waiting</Th>
                <Th>Response deadline</Th>
                <Th>Returns to action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((row) => {
                const deadline = row.openFollowUp?.waitingUntil ?? row.nextAction.dueAt
                const lapsed = deadline !== null && new Date(deadline).getTime() <= Date.now()

                return (
                  <tr key={row.customer.id}>
                    <td className="py-3 pr-4">
                      <Link
                        to={`/customers/${row.customer.id}`}
                        className="font-medium text-slate-100 hover:underline"
                      >
                        {row.customer.fullName}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-slate-300">
                      {row.coverage.lastOutboundAttemptAt === null
                        ? 'None'
                        : formatRelative(row.coverage.lastOutboundAttemptAt)}
                    </td>
                    <td className="py-3 pr-4 text-slate-300">
                      {row.openFollowUp === null || row.openFollowUp.recommendedMethod === null
                        ? '—'
                        : CONTACT_METHOD_LABELS[row.openFollowUp.recommendedMethod]}
                    </td>
                    <td className="py-3 pr-4 text-slate-300">
                      {row.msWaiting === null ? '—' : formatDuration(row.msWaiting)}
                    </td>
                    <td className="py-3 pr-4 text-slate-300">{formatDateTime(deadline, timeZone)}</td>
                    <td className="py-3">
                      {lapsed ? (
                        <Badge tone="alert">Deadline passed</Badge>
                      ) : (
                        <span className="text-slate-400">{formatRelative(deadline)}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="py-2 pr-4 font-medium">
      {children}
    </th>
  )
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return 'under an hour'
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}
