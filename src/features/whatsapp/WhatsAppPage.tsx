import { useMemo, useState } from 'react'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle, StatTile } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States.tsx'
import { useToast } from '../../components/ui/useToast.ts'
import { useWorkspace } from '../../data/useWorkspace.ts'
import { REMINDER_STAGE_LABELS } from '../../domain/models.ts'
import type { SimulatedDispatch, SimulatedInbound } from '../../data/workspace.ts'
import { projectAnnualCost, COST_LEVERS } from '../../domain/messaging/cost.ts'
import { formatRelative } from '../../lib/format.ts'
import { DEMO_APPROVED_NUMBER } from '../../data/demo/import-runtime.ts'
import { VoiceNotesSection } from './VoiceNotesSection.tsx'

const EXAMPLE_COMMANDS = [
  'Called Jesus Ayala, no answer. Follow up tomorrow at ten.',
  'Texted Jesus. Waiting for a response.',
  'Snooze Jesus until Monday.',
  'Add note to Jesus: wants a bunkhouse under $35,000.',
  'Mark Jesus sold.',
  'What is overdue?',
  'Who has no next action?',
  'Who do I need to contact today?',
]

export function WhatsAppPage() {
  const { status, error, snapshot, settings, repository, mode, refresh, run } = useWorkspace()
  const { notify } = useToast()

  const [dispatch, setDispatch] = useState<SimulatedDispatch | null>(null)
  const [command, setCommand] = useState(EXAMPLE_COMMANDS[0] ?? '')
  const [fromNumber, setFromNumber] = useState(DEMO_APPROVED_NUMBER)
  const [conversation, setConversation] = useState<
    Array<{ direction: 'in' | 'out'; body: string; rejected?: boolean }>
  >([])
  const [busy, setBusy] = useState(false)

  const notifications = snapshot?.notifications ?? []

  // Memoized on the snapshot rather than on the derived array, which would be
  // a new reference every render and defeat the memo.
  const projection = useMemo(
    () => projectAnnualCost(snapshot?.usageEvents ?? [], settings.annualCostThresholdUsd),
    [snapshot, settings.annualCostThresholdUsd],
  )

  const failures = notifications.filter((entry) => entry.status === 'failed')

  if (status === 'loading') return <LoadingState label="Loading WhatsApp…" />
  if (status === 'error') {
    return <ErrorState message={error ?? 'Could not load WhatsApp.'} onRetry={() => void refresh()} />
  }

  const simulated = mode === 'demo'

  async function runReminders() {
    if (repository.simulateReminderRun === undefined) return
    setBusy(true)

    try {
      const result = await run((repo) => repo.simulateReminderRun?.(new Date()) ?? Promise.resolve(null))
      if (result !== null) {
        setDispatch(result)
        notify(
          'success',
          `${result.sent.length} sent, ${result.suppressed.length} suppressed as duplicates.`,
        )
      }
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'Could not run reminders.')
    } finally {
      setBusy(false)
    }
  }

  async function sendCommand() {
    if (repository.simulateInboundMessage === undefined) return
    setBusy(true)

    try {
      const result = await run<SimulatedInbound>(
        (repo) =>
          repo.simulateInboundMessage?.(fromNumber, command, new Date()) ??
          Promise.resolve<SimulatedInbound>({ accepted: false, reply: '' }),
      )

      setConversation((current) => [
        ...current,
        { direction: 'in', body: command },
        {
          direction: 'out',
          body: result.accepted ? result.reply : (result.rejectionReason ?? 'Rejected.'),
          rejected: !result.accepted,
        },
      ])

      if (!result.accepted) notify('error', 'Rejected: that number is not the approved sender.')
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'Could not process that message.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Reminders, digests and text commands. Only one approved number can message or command this app."
        actions={
          simulated ? (
            <Button variant="primary" disabled={busy} onClick={() => void runReminders()}>
              Run reminder cycle
            </Button>
          ) : undefined
        }
      />

      {simulated && (
        <Card className="border-amber-900/60 bg-amber-950/20">
          <CardTitle>Simulated WhatsApp</CardTitle>
          <p className="text-sm text-slate-300">
            Nothing here reaches WhatsApp. Messages are composed by the real reminder engine and parsed
            by the real command parser, then recorded locally — so a duplicate suppressed here would be
            suppressed in production too. The approved number in demo mode is{' '}
            <span className="font-mono">{DEMO_APPROVED_NUMBER}</span>.
          </p>
        </Card>
      )}

      <VoiceNotesSection />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Messages Sent" value={projection.totals.messagesSent} />
        <StatTile label="Messages Received" value={projection.totals.messagesReceived} />
        <StatTile
          label="Failed"
          value={projection.totals.messagesFailed + failures.length}
          tone={failures.length > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label="Projected Yearly"
          value={`$${projection.projectedAnnualUsd.toFixed(2)}`}
          tone={projection.overThreshold ? 'alert' : projection.approachingThreshold ? 'warn' : 'good'}
          hint={`Threshold $${projection.thresholdUsd.toFixed(0)}`}
        />
      </div>

      {(projection.approachingThreshold || projection.overThreshold) && (
        <Card className="border-amber-900/70 bg-amber-950/20">
          <CardTitle>Projected cost is approaching your threshold</CardTitle>
          <p className="text-sm text-slate-300">
            {`Measured over ${projection.observedDays} days. Cheapest levers first:`}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-400">
            {COST_LEVERS.map((lever) => (
              <li key={lever} className="flex gap-2">
                <span aria-hidden className="text-slate-600">
                  •
                </span>
                {lever}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {simulated && (
        <Card>
          <CardTitle hint="Runs the same planner and the same idempotency check the scheduler uses.">
            Reminder cycle
          </CardTitle>

          {dispatch === null ? (
            <EmptyState
              title="No cycle run yet"
              description="Run one to see which reminders would send and which are suppressed as duplicates."
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone="good">{`${dispatch.sent.length} sent`}</Badge>
                <Badge tone="neutral">{`${dispatch.suppressed.length} suppressed`}</Badge>
              </div>

              {dispatch.sent.map((message) => (
                <article
                  key={message.idempotencyKey}
                  className="rounded-lg border border-emerald-900/50 bg-emerald-950/10 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="good">{REMINDER_STAGE_LABELS[message.stage]}</Badge>
                    <span className="font-mono text-xs text-slate-500">{message.idempotencyKey}</span>
                  </div>
                  <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-slate-200">
                    {message.body}
                  </pre>
                </article>
              ))}

              {dispatch.suppressed.length > 0 && (
                <div className="rounded-lg border border-slate-800 p-3">
                  <p className="text-sm font-medium text-slate-300">Suppressed as duplicates</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-500">
                    {dispatch.suppressed.map((item) => (
                      <li key={item.idempotencyKey} className="font-mono">
                        {`${item.idempotencyKey} — ${item.reason}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {simulated && (
        <Card>
          <CardTitle hint="Only the approved number is accepted. Try another to see it refused.">
            Send a text command
          </CardTitle>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <TextField
              label="Message"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
            />
            <TextField
              label="From number"
              value={fromNumber}
              onChange={(event) => setFromNumber(event.target.value)}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void sendCommand()}>
              Send message
            </Button>
            <Button
              variant="ghost"
              onClick={() => setFromNumber(fromNumber === DEMO_APPROVED_NUMBER ? '+15550100777' : DEMO_APPROVED_NUMBER)}
            >
              {fromNumber === DEMO_APPROVED_NUMBER ? 'Use an unknown number' : 'Use the approved number'}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXAMPLE_COMMANDS.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setCommand(example)}
                className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-800"
              >
                {example}
              </button>
            ))}
          </div>

          {conversation.length > 0 && (
            <div
              data-testid="whatsapp-conversation"
              className="mt-4 space-y-2 border-t border-slate-800 pt-4"
            >
              {conversation.map((entry, index) => (
                <div
                  key={`${index}-${entry.body.slice(0, 12)}`}
                  className={
                    entry.direction === 'in'
                      ? 'ml-auto max-w-lg rounded-lg bg-sky-950 px-3 py-2 text-sm text-sky-100'
                      : entry.rejected === true
                        ? 'max-w-lg rounded-lg bg-rose-950 px-3 py-2 text-sm text-rose-100'
                        : 'max-w-lg rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100'
                  }
                >
                  <pre className="font-sans whitespace-pre-wrap">{entry.body}</pre>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className={failures.length > 0 ? 'border-rose-900/70' : undefined}>
        <CardTitle hint="A permanent failure stays here rather than being retried forever or disappearing.">
          Delivery diagnostics
        </CardTitle>

        {notifications.length === 0 ? (
          <EmptyState title="Nothing sent yet" />
        ) : (
          <ul className="divide-y divide-slate-800">
            {notifications.slice(0, 12).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                <Badge
                  tone={
                    entry.status === 'failed' ? 'alert' : entry.status === 'queued' ? 'neutral' : 'good'
                  }
                >
                  {entry.status}
                </Badge>
                {entry.reminderStage !== null && (
                  <Badge>{REMINDER_STAGE_LABELS[entry.reminderStage]}</Badge>
                )}
                <span className="text-slate-300">{entry.payloadSummary}</span>
                {!entry.billable && <Badge tone="good">free window</Badge>}
                {entry.permanentFailure && <Badge tone="alert">permanent</Badge>}
                {entry.attemptCount > 1 && <Badge tone="warn">{`${entry.attemptCount} attempts`}</Badge>}
                {entry.error !== null && <span className="text-xs text-rose-300">{entry.error}</span>}
                <span className="ml-auto text-xs text-slate-500">
                  {formatRelative(entry.sentAt ?? entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle hint="These rules are structural, not preferences.">Cost and safety rules</CardTitle>
        <ul className="space-y-2 text-sm text-slate-300">
          <li>Messages go to the approved number only — never to a customer.</li>
          <li>Reminders are combined into digests so one message covers several follow-ups.</li>
          <li>
            Every send claims a unique idempotency key before it is sent, so a scheduler retry or a
            concurrent run cannot bill twice.
          </li>
          <li>Retries are capped at three attempts and only apply to transient failures.</li>
          <li>Inbound messages from any other number are recorded and ignored.</li>
          <li>A repeated webhook delivery is recognised by its provider message id and skipped.</li>
        </ul>
      </Card>
    </div>
  )
}
