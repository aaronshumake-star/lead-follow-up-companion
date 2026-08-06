import { Badge } from '../../components/ui/Badge.tsx'
import { CONTACT_METHOD_LABELS, type ContactMethod } from '../../domain/vocabulary.ts'
import type { ContactMethodSummary } from '../../domain/contact-methods.ts'
import { formatRelative } from '../../lib/format.ts'

/**
 * Communication coverage for one customer.
 *
 * The three rows are deliberately separate and deliberately labelled, because
 * conflating them is how a lead gets dropped while the CRM looks busy:
 *
 *   Available     — channels that exist and are not opted out
 *   Tried by me   — channels *I* personally used
 *   Not tried     — the difference
 *
 * "Tried by me" counts only activities with performedByUser === true. An
 * automated email visible in a CRM screenshot is not something I did, so it
 * never appears here and the customer correctly still reads as un-emailed.
 */
export function ContactCoverage({
  coverage,
  layout = 'stacked',
}: {
  coverage: ContactMethodSummary
  layout?: 'stacked' | 'inline'
}) {
  if (layout === 'inline') {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <MethodLine label="Available" methods={coverage.methodsAvailable} tone="neutral" />
        <MethodLine label="Tried by me" methods={coverage.methodsAttempted} tone="info" />
        <MethodLine label="Not tried" methods={coverage.methodsNotAttempted} tone="warn" />
      </div>
    )
  }

  return (
    <dl className="space-y-3 text-sm">
      <CoverageRow label="Available" methods={coverage.methodsAvailable} tone="neutral" />
      <CoverageRow label="Tried by me" methods={coverage.methodsAttempted} tone="info" />
      <CoverageRow label="Not tried" methods={coverage.methodsNotAttempted} tone="warn" />

      <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3 text-sm sm:grid-cols-4">
        <Fact
          label="Last attempt"
          value={
            coverage.lastOutboundAttemptAt === null
              ? 'None yet'
              : formatRelative(coverage.lastOutboundAttemptAt)
          }
        />
        <Fact
          label="Last response"
          value={
            coverage.lastInboundResponseAt === null
              ? 'None yet'
              : formatRelative(coverage.lastInboundResponseAt)
          }
        />
        <Fact label="Attempts" value={`${coverage.totalAttempts} total`} />
        <Fact
          label="Suggested next"
          value={
            coverage.recommendedNextMethod === null
              ? 'None available'
              : CONTACT_METHOD_LABELS[coverage.recommendedNextMethod]
          }
          hint={coverage.recommendationReason}
        />
      </div>
    </dl>
  )
}

function CoverageRow({
  label,
  methods,
  tone,
}: {
  label: string
  methods: readonly ContactMethod[]
  tone: 'neutral' | 'info' | 'warn'
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-28 shrink-0 text-xs font-medium tracking-wide text-slate-400 uppercase">
        {label}
      </dt>
      <dd className="flex flex-wrap gap-1.5">
        {methods.length === 0 ? (
          <span className="text-sm text-slate-500">
            {label === 'Tried by me' ? 'Nothing tried yet' : 'None'}
          </span>
        ) : (
          methods.map((method) => (
            <Badge key={method} tone={tone}>
              {CONTACT_METHOD_LABELS[method]}
            </Badge>
          ))
        )}
      </dd>
    </div>
  )
}

function MethodLine({
  label,
  methods,
  tone,
}: {
  label: string
  methods: readonly ContactMethod[]
  tone: 'neutral' | 'info' | 'warn'
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-slate-500">{label}:</span>
      {methods.length === 0 ? (
        <span className="text-slate-500">none</span>
      ) : (
        methods.map((method) => (
          <Badge key={method} tone={tone}>
            {CONTACT_METHOD_LABELS[method]}
          </Badge>
        ))
      )}
    </span>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="text-sm text-slate-200">{value}</dd>
      {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
