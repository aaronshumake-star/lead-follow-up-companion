import { Badge, type BadgeTone } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import {
  DUPLICATE_SIGNAL_LABELS,
  type DuplicateCandidate,
  type DuplicateConfidence,
} from '../../domain/duplicates.ts'
import { LEAD_STATUS_LABELS } from '../../domain/vocabulary.ts'
import { formatPhoneForDisplay } from '../../lib/normalize.ts'

const CONFIDENCE_TONES: Record<DuplicateConfidence, BadgeTone> = {
  certain: 'alert',
  strong: 'warn',
  possible: 'neutral',
}

const CONFIDENCE_LABELS: Record<DuplicateConfidence, string> = {
  certain: 'Almost certainly the same person',
  strong: 'Strong match',
  possible: 'Possible match',
}

/**
 * Shows what a new record might duplicate, and stops there.
 *
 * Nothing is merged automatically. The conflicting fields are listed precisely
 * so the operator can see *why* these might be two different people — a shared
 * household phone with two different names is a common and legitimate case.
 */
export function DuplicateWarning({
  candidates,
  onOpenCustomer,
}: {
  candidates: readonly DuplicateCandidate[]
  onOpenCustomer: (customerId: string) => void
}) {
  if (candidates.length === 0) return null

  return (
    <section
      aria-label="Possible duplicates"
      className="rounded-lg border border-amber-800/70 bg-amber-950/20 p-4"
    >
      <h3 className="text-sm font-semibold text-amber-200">
        {candidates.length === 1
          ? 'This might already be on file'
          : `${candidates.length} customers might already match`}
      </h3>
      <p className="mt-1 text-sm text-slate-300">
        Nothing is merged automatically. Open the existing record, or continue and create a separate
        customer.
      </p>

      <ul className="mt-3 space-y-3">
        {candidates.map(({ customer, signals, confidence, conflicts }) => (
          <li key={customer.id} className="rounded border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-100">{customer.fullName}</span>
              <Badge tone={CONFIDENCE_TONES[confidence]}>{CONFIDENCE_LABELS[confidence]}</Badge>
              <Badge>{LEAD_STATUS_LABELS[customer.leadStatus]}</Badge>
            </div>

            <p className="mt-1 text-sm text-slate-400">
              {[
                customer.dealershipCustomerId,
                formatPhoneForDisplay(customer.primaryPhone) || null,
                customer.primaryEmail,
                [customer.city, customer.state].filter((part) => part !== null).join(', ') || null,
              ]
                .filter((part): part is string => typeof part === 'string' && part !== '')
                .join(' · ')}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {signals.map((signal) => (
                <Badge key={signal} tone="info">
                  {DUPLICATE_SIGNAL_LABELS[signal]}
                </Badge>
              ))}
            </div>

            {conflicts.length > 0 && (
              <dl className="mt-2 space-y-0.5 text-xs text-slate-400">
                <dt className="font-medium text-slate-300">Conflicting fields</dt>
                {conflicts.map((conflict) => (
                  <dd key={conflict.field}>
                    {`${conflict.field}: “${conflict.existing}” on file, “${conflict.incoming}” entered`}
                  </dd>
                ))}
              </dl>
            )}

            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => onOpenCustomer(customer.id)}
            >
              Open existing customer
            </Button>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-slate-400">
        Press the save button again to create this as a separate customer.
      </p>
    </section>
  )
}
