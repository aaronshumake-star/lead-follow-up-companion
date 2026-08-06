import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { CheckboxField, SelectField, TextField } from '../../components/ui/Field.tsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States.tsx'
import { useToast } from '../../components/ui/useToast.ts'
import { useWorkspace } from '../../data/useWorkspace.ts'
import { CustomerCard } from './CustomerCard.tsx'
import { CustomerForm } from './CustomerForm.tsx'
import {
  DATE_ADDED_FILTERS,
  DATE_ADDED_FILTER_LABELS,
  EMPTY_FILTERS,
  FOLLOW_UP_FILTERS,
  FOLLOW_UP_FILTER_LABELS,
  collectLeadSources,
  filterCustomerRows,
  hasActiveFilters,
  type CustomerFilters,
  type DateAddedFilter,
  type FollowUpFilter,
} from '../../domain/customer-filters.ts'
import {
  CONTACT_METHODS,
  CONTACT_METHOD_LABELS,
  LEAD_PRIORITIES,
  LEAD_PRIORITY_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  LEAD_TEMPERATURES,
  LEAD_TEMPERATURE_LABELS,
} from '../../domain/vocabulary.ts'
import type {
  ContactMethod,
  LeadPriority,
  LeadStatus,
  LeadTemperature,
} from '../../domain/vocabulary.ts'

export function CustomersPage() {
  const { status, error, rows, settings, run, refresh } = useWorkspace()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [filters, setFilters] = useState<CustomerFilters>(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const formOpen = searchParams.get('new') === '1'

  const customers = useMemo(() => rows.map((row) => row.customer), [rows])
  const leadSources = useMemo(() => collectLeadSources(rows), [rows])
  const visible = useMemo(() => filterCustomerRows(rows, filters), [rows, filters])

  if (status === 'loading') return <LoadingState label="Loading your customers…" />
  if (status === 'error') {
    return <ErrorState message={error ?? 'Could not load your customers.'} onRetry={() => void refresh()} />
  }

  function update<K extends keyof CustomerFilters>(key: K, value: CustomerFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  }

  function openForm(open: boolean) {
    setSearchParams(open ? { new: '1' } : {}, { replace: true })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Search by name, phone, email, dealership ID, RV details or notes."
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowFilters((open) => !open)}>
              {showFilters ? 'Hide filters' : 'Filters'}
              {hasActiveFilters(filters) && (
                <span className="ml-1 rounded-full bg-sky-600 px-1.5 text-xs text-white">on</span>
              )}
            </Button>
            <Button variant="primary" onClick={() => openForm(true)}>
              New customer
            </Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <TextField
              label="Search"
              type="search"
              value={filters.search}
              onChange={(event) => update('search', event.target.value)}
              placeholder="Ayala, 5550100114, STK-48211, bunkhouse…"
            />
          </div>
          <Badge tone="info">{`${visible.length} of ${rows.length}`}</Badge>
          {hasActiveFilters(filters) && (
            <Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SelectField
                label="Follow-up state"
                value={filters.followUpState}
                onChange={(event) => update('followUpState', event.target.value as FollowUpFilter)}
                options={FOLLOW_UP_FILTERS.map((value) => ({
                  value,
                  label: FOLLOW_UP_FILTER_LABELS[value],
                }))}
              />
              <SelectField
                label="Date added"
                value={filters.dateAdded}
                onChange={(event) => update('dateAdded', event.target.value as DateAddedFilter)}
                options={DATE_ADDED_FILTERS.map((value) => ({
                  value,
                  label: DATE_ADDED_FILTER_LABELS[value],
                }))}
              />
              <SelectField
                label="Lead source"
                value={filters.leadSource}
                onChange={(event) => update('leadSource', event.target.value)}
                options={[
                  { value: '', label: 'Any source' },
                  ...leadSources.map((source) => ({ value: source, label: source })),
                ]}
              />
              <div className="space-y-2 pt-6">
                <CheckboxField
                  label="Include archived"
                  checked={filters.includeArchived}
                  onChange={(checked) => update('includeArchived', checked)}
                />
                <CheckboxField
                  label="Include sold, lost and do-not-contact"
                  checked={filters.includeClosed}
                  onChange={(checked) => update('includeClosed', checked)}
                />
              </div>
            </div>

            <FilterChips
              label="Status"
              values={LEAD_STATUSES}
              labels={LEAD_STATUS_LABELS}
              selected={filters.statuses}
              onToggle={(value) => update('statuses', toggle(filters.statuses, value as LeadStatus))}
            />
            <FilterChips
              label="Priority"
              values={LEAD_PRIORITIES}
              labels={LEAD_PRIORITY_LABELS}
              selected={filters.priorities}
              onToggle={(value) =>
                update('priorities', toggle(filters.priorities, value as LeadPriority))
              }
            />
            <FilterChips
              label="Temperature"
              values={LEAD_TEMPERATURES}
              labels={LEAD_TEMPERATURE_LABELS}
              selected={filters.temperatures}
              onToggle={(value) =>
                update('temperatures', toggle(filters.temperatures, value as LeadTemperature))
              }
            />
            <FilterChips
              label="Methods available"
              values={CONTACT_METHODS}
              labels={CONTACT_METHOD_LABELS}
              selected={filters.methodsAvailable}
              onToggle={(value) =>
                update('methodsAvailable', toggle(filters.methodsAvailable, value as ContactMethod))
              }
            />
            <FilterChips
              label="Not yet attempted by me"
              values={CONTACT_METHODS}
              labels={CONTACT_METHOD_LABELS}
              selected={filters.methodsNotAttempted}
              onToggle={(value) =>
                update(
                  'methodsNotAttempted',
                  toggle(filters.methodsNotAttempted, value as ContactMethod),
                )
              }
            />
          </div>
        )}
      </Card>

      <Card>
        <CardTitle hint="Attempted counts only contact you made yourself.">
          {`${visible.length} customer${visible.length === 1 ? '' : 's'}`}
        </CardTitle>

        {visible.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? 'No customers yet' : 'Nothing matches those filters'}
            description={
              rows.length === 0
                ? 'Add your first customer to start tracking follow-ups.'
                : 'Try clearing the search or widening the filters.'
            }
            action={
              rows.length === 0 ? (
                <Button variant="primary" onClick={() => openForm(true)}>
                  Add customer
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((row) => (
              <li key={row.customer.id}>
                <CustomerCard row={row} timeZone={settings.timeZone} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {formOpen && (
        <CustomerForm
          open
          customer={null}
          existingCustomers={customers}
          defaultPriority={settings.defaultLeadPriority}
          onClose={() => openForm(false)}
          onOpenCustomer={(id) => void navigate(`/customers/${id}`)}
          onSubmit={async (draft) => {
            const id = await run((repository) => repository.createCustomer(draft))
            notify('success', `${draft.fullName} created.`, {
              label: 'Open',
              onSelect: () => void navigate(`/customers/${id}`),
            })
          }}
        />
      )}
    </div>
  )
}

function FilterChips<T extends string>({
  label,
  values,
  labels,
  selected,
  onToggle,
}: {
  label: string
  values: readonly T[]
  labels: Record<T, string>
  selected: readonly T[]
  onToggle: (value: T) => void
}) {
  return (
    <fieldset>
      <legend className="text-xs font-medium tracking-wide text-slate-400 uppercase">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {values.map((value) => {
          const active = selected.includes(value)

          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(value)}
              className={
                active
                  ? 'rounded-full border border-sky-600 bg-sky-950 px-2.5 py-1 text-xs text-sky-200'
                  : 'rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-800'
              }
            >
              {active ? `✓ ${labels[value]}` : labels[value]}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
