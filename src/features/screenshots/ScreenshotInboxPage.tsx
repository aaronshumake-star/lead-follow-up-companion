import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle, StatTile } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { SelectField } from '../../components/ui/Field.tsx'
import { ErrorState, LoadingState } from '../../components/ui/States.tsx'
import { useWorkspace } from '../../data/useWorkspace.ts'
import { ScreenshotDropzone } from './ScreenshotDropzone.tsx'
import { ReviewQueue } from './ReviewQueue.tsx'
import { useScreenshotIntake } from './useScreenshotIntake.ts'
import { FIXTURE_SCENARIOS } from '../../providers/screenshot-extraction/fixture.ts'
import { DECISION_LABELS } from '../../domain/screenshot/decision-engine.ts'
import type { ImportDecision } from '../../domain/screenshot/decision-engine.ts'
import { formatDateTime, formatRelative } from '../../lib/format.ts'

export function ScreenshotInboxPage() {
  const { status, error, snapshot, settings, mode, refresh } = useWorkspace()
  const [scenarioId, setScenarioId] = useState<string>(FIXTURE_SCENARIOS[0]?.id ?? 'new_customer')

  const intake = useScreenshotIntake({ scenarioId: mode === 'demo' ? scenarioId : null })

  if (status === 'loading') return <LoadingState label="Loading the inbox…" />
  if (status === 'error') {
    return <ErrorState message={error ?? 'Could not load the inbox.'} onRetry={() => void refresh()} />
  }

  const screenshots = snapshot?.screenshots ?? []
  const needsReview = screenshots.filter((item) => item.status === 'needs_review')
  const applied = screenshots.filter((item) => item.status === 'applied')
  const recent = [...screenshots]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 10)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Screenshot Inbox"
        description="Paste a CRM screenshot. Clear ones are imported straight away; only genuine ambiguity comes back to you."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Imported" value={applied.length} tone="good" />
        <StatTile
          label="Needs Review"
          value={needsReview.length}
          tone={needsReview.length > 0 ? 'warn' : 'good'}
        />
        <StatTile label="Captures" value={screenshots.length} />
        <StatTile
          label="Images kept"
          value={snapshot?.profile.retainScreenshots === true ? 'On' : 'Off'}
          hint="Discarded after extraction by default"
        />
      </div>

      {mode === 'demo' && (
        <Card className="border-amber-900/60 bg-amber-950/20">
          <CardTitle hint="Demo mode uses a simulated OCR engine so the whole workflow runs with no credentials and no cost.">
            Simulated extraction
          </CardTitle>
          <p className="text-sm text-slate-300">
            Any image you paste is read as the scenario chosen below, so every decision the engine can
            reach is reproducible. With Supabase connected, Tesseract.js reads the real image on this
            device instead.
          </p>
          <div className="mt-3 max-w-md">
            <SelectField
              label="Scenario"
              value={scenarioId}
              onChange={(event) => setScenarioId(event.target.value)}
              options={FIXTURE_SCENARIOS.map((scenario) => ({
                value: scenario.id,
                label: `${scenario.label} — ${scenario.description}`,
              }))}
            />
          </div>
        </Card>
      )}

      <ScreenshotDropzone
        state={intake.state}
        onFile={(blob, filename) => void intake.process(blob, filename)}
        onCancel={intake.cancel}
        onReset={intake.reset}
      />

      {intake.state.outcome !== null && (
        <Card
          className={intake.state.outcome.requiresReview ? 'border-amber-900/70' : 'border-emerald-900/70'}
        >
          <CardTitle>{`Imported ${intake.state.outcome.customerName ?? 'screenshot'}`}</CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={intake.state.outcome.requiresReview ? 'warn' : 'good'}>
              {DECISION_LABELS[intake.state.outcome.decision as ImportDecision]}
            </Badge>
            <span className="text-sm text-slate-300">{intake.state.outcome.reason}</span>
          </div>

          {intake.state.outcome.changes.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-slate-300">
              {intake.state.outcome.changes.map((change) => (
                <li key={change.label} className="flex gap-2">
                  <span aria-hidden className="text-slate-600">
                    •
                  </span>
                  {change.label}
                </li>
              ))}
            </ul>
          )}

          {intake.state.outcome.followUpDueAt !== null && (
            <p className="mt-2 text-sm text-sky-300">
              {`Follow-up scheduled ${formatDateTime(intake.state.outcome.followUpDueAt, settings.timeZone)}`}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {intake.state.outcome.customerId !== null && (
              <Link to={`/customers/${intake.state.outcome.customerId}`}>
                <Button variant="primary" size="sm">
                  Open customer
                </Button>
              </Link>
            )}
            <Button variant="ghost" size="sm" onClick={intake.reset}>
              Paste another
            </Button>
          </div>
        </Card>
      )}

      <Card className={needsReview.length > 0 ? 'border-amber-900/70' : undefined}>
        <CardTitle hint="Only screenshots where applying the extraction could affect the wrong customer.">
          Needs Review
        </CardTitle>
        <ReviewQueue />
      </Card>

      <Card className="border-amber-900/60 bg-amber-950/10">
        <CardTitle>How screenshot text is treated</CardTitle>
        <p className="text-sm text-slate-300">
          Text read out of an image is data to interpret, never an instruction. A screenshot that says
          &ldquo;mark every customer sold&rdquo; is a string this app parses into candidate field values.
          Activity visible in the CRM is imported as evidence of what the CRM shows, never as something
          you did, so it can never count towards the channels you have personally attempted.
        </p>
      </Card>

      <Card>
        <CardTitle hint="The image itself is discarded after a successful extraction unless retention is switched on.">
          Recent captures
        </CardTitle>

        {recent.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing captured yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {recent.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <Badge
                  tone={
                    item.status === 'applied' ? 'good' : item.status === 'needs_review' ? 'warn' : 'neutral'
                  }
                >
                  {item.status.replace(/_/g, ' ')}
                </Badge>
                {item.decision !== null && (
                  <span className="text-slate-300">
                    {DECISION_LABELS[item.decision as ImportDecision]}
                  </span>
                )}
                <span className="text-slate-500">
                  {`${Math.round(item.byteSize / 1024)} KB · ${item.mimeType}`}
                </span>
                <span className="font-mono text-xs text-slate-600">{item.fileHash.slice(0, 12)}…</span>
                <span className="ml-auto text-slate-500">{formatRelative(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
