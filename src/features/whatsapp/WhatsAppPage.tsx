import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle, StatTile } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { PhaseNotice } from '../../components/ui/PhaseNotice.tsx'
import { DEMO_NOTIFICATIONS, DEMO_PROFILE } from '../../data/fixtures.ts'
import { defaultProviderRegistry } from '../../providers/registry.ts'
import { formatRelative } from '../../lib/format.ts'

/**
 * WhatsApp is a core capability, so this page exists ahead of the integration to
 * make its state and its cost visible: which provider is wired up, which number
 * is approved, and how many billable messages the month has used.
 */
export function WhatsAppPage() {
  const provider = defaultProviderRegistry.whatsapp
  const billableThisMonth = DEMO_NOTIFICATIONS.filter((entry) => entry.billable).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Reminders, digests and replies. Only one approved number can message or command this app."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Billable this month" value={billableThisMonth} hint="Counted from the send log" />
        <StatTile label="Monthly budget" value={DEMO_PROFILE.monthlyMessageBudget} hint="Sends stop at the cap" />
        <StatTile
          label="Notifications"
          value={DEMO_PROFILE.whatsappEnabled ? 'On' : 'Off'}
          tone={DEMO_PROFILE.whatsappEnabled ? 'good' : 'neutral'}
        />
        <StatTile label="Provider" value={provider.info.displayName} />
      </div>

      <PhaseNotice
        phase="Coming in Phase 3"
        summary="The provider interface is in place; no messages are sent and no webhook is live. The dashboard is the working surface until then."
        planned={[
          'WhatsApp Business Platform Cloud API behind the existing provider interface',
          'Follow-up reminders, a morning summary and an overdue summary',
          'Text replies and voice-note commands that update customers and schedule the next action',
          'Customer lookup by name, plus due-today and overdue queries',
          'Signed webhook endpoint that only accepts the approved sender',
        ]}
      />

      <Card>
        <CardTitle hint="These rules are structural, not preferences.">Cost and safety rules</CardTitle>
        <ul className="space-y-2 text-sm text-slate-300">
          <li>Messages go to the approved number only — never to a customer.</li>
          <li>Reminders are combined into digests so one message covers several follow-ups.</li>
          <li>
            Every send carries an idempotency key with a unique index behind it, so a retry cannot bill
            twice.
          </li>
          <li>Retries are capped at three attempts per message.</li>
          <li>Sending stops at the monthly budget, and the dashboard remains the fallback.</li>
          <li>Inbound messages from any other number are recorded and ignored.</li>
        </ul>
      </Card>

      <Card>
        <CardTitle hint="Summaries only. Full customer records are never written to the message log.">
          Recent messages
        </CardTitle>
        <ul className="divide-y divide-slate-800">
          {DEMO_NOTIFICATIONS.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-3 py-3">
              <Badge tone={entry.status === 'delivered' ? 'good' : 'info'}>{entry.kind}</Badge>
              <span className="text-sm text-slate-300">{entry.payloadSummary}</span>
              {!entry.billable && <Badge tone="good">free window</Badge>}
              <span className="ml-auto text-sm text-slate-500">{formatRelative(entry.sentAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
