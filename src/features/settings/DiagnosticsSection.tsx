import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { useWorkspace } from '../../data/useWorkspace.ts'
import { projectAnnualCost } from '../../domain/messaging/cost.ts'
import { formatRelative } from '../../lib/format.ts'

export function DiagnosticsSection() {
  const { mode, snapshot, status, repository, run } = useWorkspace()
  if (snapshot === null) return null

  const voice = snapshot.voiceRecords
  const notifications = snapshot.notifications
  const cost = projectAnnualCost(snapshot.usageEvents, snapshot.profile.annualCostThresholdUsd)
  const facts = [
    ['Storage mode', mode],
    ['Workspace', status],
    ['WhatsApp', mode === 'demo' ? 'simulated' : snapshot.profile.whatsappEnabled ? 'enabled' : 'disabled'],
    ['Scheduler', mode === 'demo' ? 'simulated/manual' : 'Cloudflare cron'],
    ['Last reminder send', relative(maxDate(notifications.map((item) => item.sentAt)))],
    ['Last transcription', relative(maxDate(voice.filter((item) => item.status === 'applied').map((item) => item.createdAt)))],
    ['Last voice failure', relative(maxDate(voice.filter((item) => item.status === 'failed').map((item) => item.createdAt)))],
    ['Permanent failures', String(notifications.filter((item) => item.permanentFailure).length)],
    ['Pending retries', String(notifications.filter((item) => item.nextAttemptAt !== null).length)],
    ['Retained screenshots', String(snapshot.screenshots.filter((item) => item.retained).length)],
    ['Retained audio', String(voice.filter((item) => item.audioRetained).length)],
    ['Projected annual cost', `$${cost.projectedAnnualUsd.toFixed(2)}`],
    ['App version', '4.0.0'],
    ['Database migration', '20260808000100'],
  ]

  return (
    <Card>
      <CardTitle hint="Safe operational metadata only; no tokens, signatures or full messages.">
        Operational Diagnostics
      </CardTitle>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs tracking-wide text-slate-500 uppercase">{label}</dt>
            <dd className="mt-1 text-sm text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
        <Badge tone={status === 'ready' ? 'good' : 'warn'}>{status === 'ready' ? 'Health check passed' : status}</Badge>
        {mode === 'demo' && repository.simulateReminderRun !== undefined && (
          <Button size="sm" onClick={() => void run((repo) => repo.simulateReminderRun?.() ?? Promise.resolve(null))}>
            Run simulated health check
          </Button>
        )}
      </div>
    </Card>
  )
}

function maxDate(values: Array<string | null>): string | null {
  return values.filter((value): value is string => value !== null).sort().at(-1) ?? null
}

function relative(value: string | null): string {
  return value === null ? 'never' : formatRelative(value)
}
