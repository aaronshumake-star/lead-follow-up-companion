import { useMemo } from 'react'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { PhaseNotice } from '../../components/ui/PhaseNotice.tsx'
import {
  DEMO_CUSTOMERS,
  activitiesForCustomer,
  contactMethodsForCustomer,
} from '../../data/fixtures.ts'
import { summarizeContactMethods } from '../../domain/contact-methods.ts'
import { CONTACT_METHOD_LABELS, LEAD_STATUS_LABELS } from '../../domain/vocabulary.ts'
import { formatPhoneForDisplay } from '../../lib/normalize.ts'
import { formatRelative } from '../../lib/format.ts'

/**
 * Placeholder customer list. The editable lead tracker arrives in a later
 * phase; what is shown here is the communication accounting, because that is
 * the part most easily got wrong.
 *
 * Note the difference between the two method rows: "attempted" counts only
 * contact I personally made, so a customer whose CRM record shows automated
 * outreach still reads as untouched.
 */
export function CustomersPage() {
  const rows = useMemo(
    () =>
      DEMO_CUSTOMERS.map((customer) => ({
        customer,
        summary: summarizeContactMethods(
          contactMethodsForCustomer(customer.id),
          activitiesForCustomer(customer.id),
        ),
      })),
    [],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Fictional records for now. Communication is split between what is available and what I actually tried."
      />

      <PhaseNotice
        phase="Phase 1"
        summary="Read-only preview. Editing, search and merge land with the lead tracker."
        planned={[
          'Create and edit customers, contact methods and RV interests',
          'Search by name, phone, email or dealership customer ID',
          'Duplicate detection using the normalized name, phone and email keys',
          'Full activity timeline per customer',
        ]}
      />

      <Card>
        <CardTitle hint="Methods attempted counts only contact I made myself.">
          {`${rows.length} customers`}
        </CardTitle>

        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs tracking-wide text-slate-400 uppercase">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Customer
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Phone
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Attempted by me
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Not yet tried
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Recommended next
                </th>
                <th scope="col" className="py-2 font-medium">
                  Last activity
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map(({ customer, summary }) => (
                <tr key={customer.id} className="align-top">
                  <td className="py-3 pr-4">
                    <p className="font-medium text-slate-100">{customer.fullName}</p>
                    <p className="text-xs text-slate-500">
                      {customer.city ?? '—'}
                      {customer.state !== null ? `, ${customer.state}` : ''}
                    </p>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge>{LEAD_STATUS_LABELS[customer.leadStatus]}</Badge>
                  </td>
                  <td className="py-3 pr-4 text-slate-300">
                    {formatPhoneForDisplay(customer.primaryPhone) || '—'}
                  </td>
                  <td className="py-3 pr-4 text-slate-300">
                    {summary.methodsAttempted.length === 0
                      ? 'Nothing yet'
                      : summary.methodsAttempted.map((m) => CONTACT_METHOD_LABELS[m]).join(', ')}
                  </td>
                  <td className="py-3 pr-4 text-slate-400">
                    {summary.methodsNotAttempted.length === 0
                      ? '—'
                      : summary.methodsNotAttempted.map((m) => CONTACT_METHOD_LABELS[m]).join(', ')}
                  </td>
                  <td className="py-3 pr-4">
                    {summary.recommendedNextMethod === null ? (
                      <span className="text-slate-500">None available</span>
                    ) : (
                      <>
                        <Badge tone="info">
                          {CONTACT_METHOD_LABELS[summary.recommendedNextMethod]}
                        </Badge>
                        <p className="mt-1 text-xs text-slate-500">{summary.recommendationReason}</p>
                      </>
                    )}
                  </td>
                  <td className="py-3 text-slate-500">{formatRelative(customer.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
