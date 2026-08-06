import { Link } from 'react-router'
import { Badge, type BadgeTone } from '../../components/ui/Badge.tsx'
import { ContactCoverage } from './ContactCoverage.tsx'
import { CustomerActions } from './CustomerActions.tsx'
import type { CustomerRow } from '../../domain/dashboard.ts'
import {
  CONTACT_METHOD_LABELS,
  LEAD_PRIORITY_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_TEMPERATURE_LABELS,
} from '../../domain/vocabulary.ts'
import type { LeadPriority, LeadStatus } from '../../domain/vocabulary.ts'
import { formatDateTime, formatRelative } from '../../lib/format.ts'
import { formatPhoneForDisplay } from '../../lib/normalize.ts'
import { cn } from '../../lib/cn.ts'
import { describeVehicle } from './vehicle.ts'

const STATUS_TONES: Record<LeadStatus, BadgeTone> = {
  new: 'info',
  working: 'info',
  follow_up_scheduled: 'info',
  waiting_on_customer: 'warn',
  appointment_scheduled: 'good',
  sold: 'good',
  lost: 'neutral',
  do_not_contact: 'neutral',
  archived: 'neutral',
}

const PRIORITY_TONES: Record<LeadPriority, BadgeTone> = {
  urgent: 'alert',
  high: 'warn',
  normal: 'neutral',
  low: 'neutral',
}

/**
 * Compact customer card for the dashboard queues.
 *
 * Status is always carried by text as well as colour, since a colour-only
 * signal is useless to anyone who cannot distinguish the hues and useless in a
 * screenshot.
 */
export function CustomerCard({
  row,
  showActions = true,
  timeZone,
}: {
  row: CustomerRow
  showActions?: boolean
  timeZone: string
}) {
  const { customer, coverage, nextAction, openFollowUp, primaryVehicle } = row
  const overdue = nextAction.isOverdue
  const forgotten = nextAction.state === 'no_next_action'

  return (
    <article
      className={cn(
        'rounded-lg border bg-slate-900/50 p-4',
        overdue ? 'border-amber-800/70' : forgotten ? 'border-rose-800/70' : 'border-slate-800',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/customers/${customer.id}`}
              className="text-base font-semibold text-slate-100 hover:underline"
            >
              {customer.fullName}
            </Link>
            <Badge tone={STATUS_TONES[customer.leadStatus]}>
              {LEAD_STATUS_LABELS[customer.leadStatus]}
            </Badge>
            <Badge tone={PRIORITY_TONES[customer.leadPriority]}>
              {LEAD_PRIORITY_LABELS[customer.leadPriority]}
            </Badge>
            <Badge>{LEAD_TEMPERATURE_LABELS[customer.leadTemperature]}</Badge>

            {forgotten && <Badge tone="alert">Needs a next action</Badge>}
            {overdue && <Badge tone="warn">Overdue</Badge>}
          </div>

          <p className="mt-1 text-sm text-slate-400">
            {[customer.city, customer.state].filter((part) => part !== null).join(', ') || 'No location'}
            {primaryVehicle !== null && ` · ${describeVehicle(primaryVehicle)}`}
          </p>

          {customer.pinnedNote !== null && (
            <p className="mt-2 rounded border border-slate-800 bg-slate-950/50 px-2 py-1 text-sm text-amber-200">
              {customer.pinnedNote}
            </p>
          )}
        </div>

        <dl className="shrink-0 text-right text-sm">
          <dt className="text-xs tracking-wide text-slate-500 uppercase">Next action</dt>
          <dd className={cn('font-medium', overdue ? 'text-amber-300' : 'text-slate-200')}>
            {nextAction.dueAt === null ? nextAction.reason : formatRelative(nextAction.dueAt)}
          </dd>
          {nextAction.dueAt !== null && (
            <dd className="text-xs text-slate-500">{formatDateTime(nextAction.dueAt, timeZone)}</dd>
          )}
          {openFollowUp !== null && openFollowUp.reason !== null && (
            <dd className="mt-1 max-w-56 text-xs text-slate-400">{openFollowUp.reason}</dd>
          )}
        </dl>
      </header>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <Availability label="Phone" value={formatPhoneForDisplay(customer.primaryPhone)} />
        <Availability
          label="Text"
          value={coverage.methodsAvailable.includes('sms') ? 'Available' : 'Not on file'}
        />
        <Availability label="Email" value={customer.primaryEmail ?? 'Not on file'} />
      </div>

      <div className="mt-3 border-t border-slate-800 pt-3">
        <ContactCoverage coverage={coverage} layout="inline" />
        <p className="mt-2 text-xs text-slate-500">
          {`${coverage.totalAttempts} personal attempt${coverage.totalAttempts === 1 ? '' : 's'}`}
          {' · last activity '}
          {row.lastActivity === null ? 'none' : formatRelative(row.lastActivity.occurredAt)}
          {coverage.lastInboundResponseAt !== null &&
            ` · last reply ${formatRelative(coverage.lastInboundResponseAt)}`}
          {coverage.recommendedNextMethod !== null &&
            ` · try ${CONTACT_METHOD_LABELS[coverage.recommendedNextMethod]} next`}
        </p>
      </div>

      {showActions && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <CustomerActions row={row} variant="compact" />
        </div>
      )}
    </article>
  )
}

function Availability({ label, value }: { label: string; value: string }) {
  const missing = value === '' || value === 'Not on file'

  return (
    <div>
      <span className="text-xs tracking-wide text-slate-500 uppercase">{label}</span>
      <p className={missing ? 'text-slate-500' : 'text-slate-200'}>{missing ? 'Not on file' : value}</p>
    </div>
  )
}
