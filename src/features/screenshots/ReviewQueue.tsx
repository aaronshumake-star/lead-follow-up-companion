import { useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { TextField } from '../../components/ui/Field.tsx'
import { EmptyState } from '../../components/ui/States.tsx'
import { useToast } from '../../components/ui/useToast.ts'
import { useWorkspace } from '../../data/useWorkspace.ts'
import type { ReviewAction } from '../../data/workspace.ts'
import { DECISION_LABELS } from '../../domain/screenshot/decision-engine.ts'
import type { ImportDecision } from '../../domain/screenshot/decision-engine.ts'
import { formatRelative } from '../../lib/format.ts'
import { redactForLogging } from '../../lib/untrusted.ts'

/**
 * The exception queue.
 *
 * Only screenshots the decision engine refused to apply land here — an
 * ambiguous match, a conflicting identifier, or an unreadable capture. Everything
 * else was already written, which is the point: review is a cost, so it is
 * reserved for the cases where guessing could combine two different people.
 *
 * Each item offers the correction interface inline, so fixing a misread name is
 * a couple of keystrokes rather than a trip to the customer form.
 */
export function ReviewQueue() {
  const { snapshot, rows, run } = useWorkspace()
  const { notify } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const items = (snapshot?.screenshots ?? []).filter((item) => item.status === 'needs_review')

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing needs review"
        description="Screenshots only appear here when applying them could affect the wrong customer."
      />
    )
  }

  return (
    <ul className="space-y-4">
      {items.map((screenshot) => {
        const candidates = (snapshot?.matchCandidates ?? []).filter(
          (candidate) => candidate.screenshotId === screenshot.id,
        )
        const fields = (snapshot?.extractionFields ?? []).filter(
          (field) => field.screenshotId === screenshot.id,
        )

        return (
          <ReviewItem
            key={screenshot.id}
            screenshotId={screenshot.id}
            decision={(screenshot.decision as ImportDecision | null) ?? 'NEEDS_MATCH_REVIEW'}
            reason={screenshot.decisionReason}
            confidence={screenshot.overallConfidence}
            warnings={screenshot.warnings}
            rawText={screenshot.rawText}
            createdAt={screenshot.createdAt}
            fields={fields}
            candidates={candidates.map((candidate) => ({
              ...candidate,
              name:
                rows.find((row) => row.customer.id === candidate.customerId)?.customer.fullName ??
                'Unknown customer',
            }))}
            busy={busyId === screenshot.id}
            onResolve={async (action, corrections) => {
              setBusyId(screenshot.id)
              try {
                const outcome = await run((repo) =>
                  repo.resolveScreenshotReview({
                    screenshotId: screenshot.id,
                    action,
                    corrections,
                  }),
                )
                notify('success', `Review resolved: ${outcome.reason}`)
              } catch (cause) {
                notify('error', cause instanceof Error ? cause.message : 'Could not resolve that.')
              } finally {
                setBusyId(null)
              }
            }}
          />
        )
      })}
    </ul>
  )
}

interface ReviewItemProps {
  screenshotId: string
  decision: ImportDecision
  reason: string | null
  confidence: number | null
  warnings: string[]
  rawText: string | null
  createdAt: string
  fields: Array<{ fieldKey: string; fieldValue: string | null; confidence: number | null; verified: boolean }>
  candidates: Array<{ customerId: string; name: string; score: number; reasons: string[] }>
  busy: boolean
  onResolve: (
    action: ReviewAction,
    corrections?: Record<string, string | null>,
  ) => Promise<void>
}

function ReviewItem(props: ReviewItemProps) {
  const initial = Object.fromEntries(
    props.fields.map((field) => [field.fieldKey, field.fieldValue ?? '']),
  ) as Record<string, string>

  const [corrections, setCorrections] = useState<Record<string, string>>(initial)
  const [editing, setEditing] = useState(false)

  const correctionPayload = {
    fullName: corrections['full_name'] ?? null,
    phone: corrections['primary_phone'] ?? null,
    email: corrections['primary_email'] ?? null,
    customerId: corrections['dealership_customer_id'] ?? null,
    city: corrections['city'] ?? null,
    state: corrections['state'] ?? null,
  }

  return (
    <li className="rounded-lg border border-amber-900/60 bg-amber-950/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warn">{DECISION_LABELS[props.decision]}</Badge>
        {props.confidence !== null && (
          <Badge>{`confidence ${Math.round(props.confidence * 100)}%`}</Badge>
        )}
        {props.warnings.map((warning) => (
          <Badge key={warning} tone="neutral">
            {warning.replace(/_/g, ' ')}
          </Badge>
        ))}
        <span className="ml-auto text-xs text-slate-500">{formatRelative(props.createdAt)}</span>
      </div>

      {props.reason !== null && <p className="mt-2 text-sm text-slate-300">{props.reason}</p>}

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {props.fields.map((field) => (
          <div key={field.fieldKey}>
            <dt className="text-xs tracking-wide text-slate-500 uppercase">
              {field.fieldKey.replace(/_/g, ' ')}
            </dt>
            <dd className="flex items-center gap-2 text-slate-200">
              {field.fieldValue ?? '—'}
              {!field.verified && <Badge tone="warn">unverified</Badge>}
            </dd>
          </div>
        ))}
      </dl>

      {props.rawText !== null && (
        <p className="mt-3 font-mono text-xs text-slate-500">
          {/* Redacted: the preview must not put a phone number on screen twice. */}
          {redactForLogging(props.rawText, 240)}
        </p>
      )}

      {props.candidates.length > 0 && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <p className="text-xs tracking-wide text-slate-400 uppercase">Possible customers</p>
          <ul className="mt-2 space-y-2">
            {props.candidates.map((candidate) => (
              <li key={candidate.customerId} className="flex flex-wrap items-center gap-2 text-sm">
                <Link
                  to={`/customers/${candidate.customerId}`}
                  className="font-medium text-slate-100 hover:underline"
                >
                  {candidate.name}
                </Link>
                <Badge tone="info">{`${Math.round(candidate.score * 100)}% match`}</Badge>
                {candidate.reasons.map((reason) => (
                  <Badge key={reason}>{reason.replace(/_/g, ' ')}</Badge>
                ))}
                <Button
                  className="ml-auto"
                  size="sm"
                  variant="primary"
                  disabled={props.busy}
                  onClick={() =>
                    void props.onResolve(
                      { kind: 'select_existing', customerId: candidate.customerId },
                      correctionPayload,
                    )
                  }
                >
                  Use this customer
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={props.busy}
                  onClick={() =>
                    void props.onResolve({ kind: 'keep_existing_fields', customerId: candidate.customerId })
                  }
                >
                  Keep existing fields
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <div className="mt-3 grid gap-3 border-t border-slate-800 pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {['full_name', 'primary_phone', 'primary_email', 'dealership_customer_id', 'city', 'state'].map(
            (key) => (
              <TextField
                key={key}
                label={key.replace(/_/g, ' ')}
                value={corrections[key] ?? ''}
                onChange={(event) =>
                  setCorrections((current) => ({ ...current, [key]: event.target.value }))
                }
              />
            ),
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-3">
        <Button size="sm" variant="secondary" onClick={() => setEditing((open) => !open)}>
          {editing ? 'Hide corrections' : 'Correct the reading'}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={props.busy}
          onClick={() => void props.onResolve({ kind: 'create_new' }, correctionPayload)}
        >
          Create new customer
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={props.busy}
          onClick={() => void props.onResolve({ kind: 'discard' })}
        >
          Discard screenshot
        </Button>
      </div>
    </li>
  )
}
