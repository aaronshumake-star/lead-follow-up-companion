import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States.tsx'
import { SelectField, TextField } from '../../components/ui/Field.tsx'
import { Modal } from '../../components/ui/Modal.tsx'
import { useToast } from '../../components/ui/useToast.ts'
import { useWorkspace } from '../../data/useWorkspace.ts'
import { ContactCoverage } from './ContactCoverage.tsx'
import { CustomerActions } from './CustomerActions.tsx'
import { CustomerForm } from './CustomerForm.tsx'
import { describeVehicle } from './vehicle.ts'
import { ActivityTimeline } from '../activities/ActivityTimeline.tsx'
import {
  CONTACT_METHODS,
  CONTACT_METHOD_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  LEAD_PRIORITY_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_TEMPERATURE_LABELS,
  VEHICLE_CONDITIONS,
  VEHICLE_CONDITION_LABELS,
} from '../../domain/vocabulary.ts'
import type { ContactMethod, VehicleCondition } from '../../domain/vocabulary.ts'
import { formatDateTime, formatRelative } from '../../lib/format.ts'
import { formatPhoneForDisplay } from '../../lib/normalize.ts'
import { effectiveDueAt } from '../../domain/next-action.ts'

export function CustomerDetailPage() {
  const { customerId = '' } = useParams()
  const { status, error, rowsById, snapshot, settings, run, refresh } = useWorkspace()
  const { notify } = useToast()
  const navigate = useNavigate()

  const [editing, setEditing] = useState(false)
  const [addingMethod, setAddingMethod] = useState(false)
  const [addingVehicle, setAddingVehicle] = useState(false)
  const [confirming, setConfirming] = useState<null | {
    title: string
    message: string
    confirmLabel: string
    onConfirm: () => Promise<void>
  }>(null)

  if (status === 'loading') return <LoadingState label="Loading customer…" />
  if (status === 'error') {
    return <ErrorState message={error ?? 'Could not load this customer.'} onRetry={() => void refresh()} />
  }

  const row = rowsById.get(customerId)
  if (row === undefined) {
    return (
      <Card>
        <EmptyState
          title="Customer not found"
          description="It may have been deleted."
          action={
            <Link to="/customers">
              <Button variant="secondary">Back to customers</Button>
            </Link>
          }
        />
      </Card>
    )
  }

  const { customer, coverage, nextAction, openFollowUp } = row
  const archived = customer.archivedAt !== null

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.fullName}
        description={[
          formatPhoneForDisplay(customer.primaryPhone) || null,
          customer.primaryEmail,
          [customer.city, customer.state].filter((part) => part !== null).join(', ') || null,
          customer.dealershipCustomerId === null ? null : `ID ${customer.dealershipCustomerId}`,
        ]
          .filter((part): part is string => typeof part === 'string' && part !== '')
          .join(' · ')}
        actions={
          <>
            <Link to="/customers">
              <Button variant="ghost">Back</Button>
            </Link>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={archived ? 'neutral' : 'info'}>{LEAD_STATUS_LABELS[customer.leadStatus]}</Badge>
          <Badge>{LEAD_PRIORITY_LABELS[customer.leadPriority]}</Badge>
          <Badge>{LEAD_TEMPERATURE_LABELS[customer.leadTemperature]}</Badge>
          {customer.preferredContactMethod !== null && (
            <Badge tone="info">
              {`Prefers ${CONTACT_METHOD_LABELS[customer.preferredContactMethod]}`}
            </Badge>
          )}
          {row.primaryVehicle !== null && <Badge>{describeVehicle(row.primaryVehicle)}</Badge>}
          {nextAction.state === 'no_next_action' && <Badge tone="alert">Needs a next action</Badge>}
          {nextAction.isOverdue && <Badge tone="warn">Overdue</Badge>}
        </div>

        <p className="mt-3 text-sm text-slate-300">
          <span className="text-slate-500">Current next action: </span>
          {nextAction.dueAt === null
            ? nextAction.reason
            : `${nextAction.reason} — ${formatDateTime(nextAction.dueAt, settings.timeZone)} (${formatRelative(nextAction.dueAt)})`}
        </p>

        {customer.pinnedNote !== null && (
          <p className="mt-3 rounded border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
            {customer.pinnedNote}
          </p>
        )}

        <div className="mt-4 border-t border-slate-800 pt-4">
          <CustomerActions row={row} variant="full" />
        </div>

        {archived && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
            <span className="text-sm text-slate-400">This customer is archived.</span>
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                void run((repository) => repository.restoreCustomer(customer.id, 'working')).then(() =>
                  notify('success', `${customer.fullName} restored.`),
                )
              }
            >
              Restore to working
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle hint="Attempted counts only contact you made yourself.">Contact coverage</CardTitle>
        <ContactCoverage coverage={coverage} />

        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-300">Contact methods on file</h3>
            <Button size="sm" variant="secondary" onClick={() => setAddingMethod(true)}>
              Add method
            </Button>
          </div>

          {row.contactMethods.length === 0 ? (
            <EmptyState title="No contact methods yet" />
          ) : (
            <ul className="mt-3 divide-y divide-slate-800">
              {row.contactMethods.map((method) => (
                <li key={method.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Badge>{CONTACT_METHOD_LABELS[method.method]}</Badge>
                  <span className="text-slate-200">{method.value}</span>
                  {method.isPrimary && <Badge tone="info">Primary</Badge>}
                  {method.isVerified && <Badge tone="good">Verified</Badge>}
                  {method.optedOut && <Badge tone="alert">Opted out</Badge>}
                  <Button
                    className="ml-auto"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void run((repository) => repository.removeContactMethod(method.id)).then(() =>
                        notify('success', 'Contact method removed.'),
                      )
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle hint="One open follow-up at a time, enforced by the database.">Follow-ups</CardTitle>

          {openFollowUp === null ? (
            <EmptyState
              title="No open follow-up"
              description="This customer is in the no-next-action queue until one is scheduled."
            />
          ) : (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={nextAction.isOverdue ? 'warn' : 'info'}>
                  {FOLLOW_UP_STATUS_LABELS[openFollowUp.status]}
                </Badge>
                <Badge>{LEAD_PRIORITY_LABELS[openFollowUp.priority]}</Badge>
                {openFollowUp.isAppointment && <Badge tone="good">Appointment</Badge>}
                {openFollowUp.recommendedMethod !== null && (
                  <Badge tone="info">
                    {`via ${CONTACT_METHOD_LABELS[openFollowUp.recommendedMethod]}`}
                  </Badge>
                )}
              </div>

              <p className="mt-2 text-sm text-slate-200">
                {formatDateTime(effectiveDueAt(openFollowUp), settings.timeZone)}
                <span className="text-slate-500">{` · ${formatRelative(effectiveDueAt(openFollowUp))}`}</span>
              </p>
              {openFollowUp.reason !== null && (
                <p className="mt-1 text-sm text-slate-400">{openFollowUp.reason}</p>
              )}
              {openFollowUp.waitingUntil !== null && (
                <p className="mt-1 text-sm text-amber-300">
                  {`Response deadline ${formatDateTime(openFollowUp.waitingUntil, settings.timeZone)}`}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    void run((repository) => repository.completeFollowUp(customer.id)).then(() =>
                      notify('success', 'Follow-up completed.'),
                    )
                  }
                >
                  Complete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setConfirming({
                      title: 'Cancel follow-up',
                      message:
                        'Cancel this follow-up? It stays in history, and the customer will have no next action until you schedule one.',
                      confirmLabel: 'Cancel follow-up',
                      onConfirm: async () => {
                        await run((repository) => repository.cancelFollowUp(customer.id))
                        notify('success', 'Follow-up canceled.')
                      },
                    })
                  }
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {row.followUpHistory.length > 0 && (
            <div className="mt-4 border-t border-slate-800 pt-4">
              <h3 className="mb-2 text-sm font-medium text-slate-300">History</h3>
              <ul className="space-y-1.5 text-sm">
                {row.followUpHistory.map((followUp) => (
                  <li key={followUp.id} className="flex flex-wrap items-center gap-2">
                    <Badge>{FOLLOW_UP_STATUS_LABELS[followUp.status]}</Badge>
                    <span className="text-slate-300">
                      {formatDateTime(followUp.dueAt, settings.timeZone)}
                    </span>
                    {followUp.outcomeNote !== null && (
                      <span className="text-xs text-slate-500">{followUp.outcomeNote}</span>
                    )}
                    {followUp.rescheduledFromId !== null && (
                      <Badge tone="info">Replaced an earlier follow-up</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">
              Vehicle interests
            </h2>
            <Button size="sm" variant="secondary" onClick={() => setAddingVehicle(true)}>
              Add unit
            </Button>
          </div>

          {row.vehicleInterests.length === 0 ? (
            <EmptyState title="No units recorded" />
          ) : (
            <ul className="divide-y divide-slate-800">
              {row.vehicleInterests.map((vehicle) => (
                <li key={vehicle.id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-100">
                      {describeVehicle(vehicle)}
                    </span>
                    <Badge>{VEHICLE_CONDITION_LABELS[vehicle.condition]}</Badge>
                    {vehicle.isPrimary && <Badge tone="info">Primary interest</Badge>}
                    <Button
                      className="ml-auto"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void run((repository) => repository.removeVehicleInterest(vehicle.id)).then(
                          () => notify('success', 'Unit removed.'),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  {vehicle.notes !== null && (
                    <p className="mt-1 text-sm text-slate-400">{vehicle.notes}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
            <h3 className="text-sm font-medium text-slate-300">Notes</h3>
            <NoteBlock label="Objections" value={customer.objections} />
            <NoteBlock label="Trade information" value={customer.tradeNotes} />
            <NoteBlock label="Finance status" value={customer.financeStatus} />
            <NoteBlock label="General notes" value={customer.notes} />
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle hint="Every row shows its source and whether you made the contact yourself.">
          Activity timeline
        </CardTitle>
        <ActivityTimeline
          activities={row.activities}
          auditEntries={snapshot?.auditEntries ?? []}
          timeZone={settings.timeZone}
          onEdit={async (activityId, patch, reason) => {
            await run((repository) => repository.updateActivity(activityId, patch, reason))
            notify('success', 'Activity corrected and recorded in the audit log.')
          }}
        />
      </Card>

      <Card className="border-rose-900/50">
        <CardTitle hint="These need confirmation because they are hard to undo.">Danger zone</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            onClick={() =>
              setConfirming({
                title: 'Delete customer',
                message: `Permanently delete ${customer.fullName} and all of their activity? This cannot be undone. Archiving is usually the better choice.`,
                confirmLabel: 'Delete permanently',
                onConfirm: async () => {
                  await run((repository) => repository.deleteCustomer(customer.id))
                  notify('success', 'Customer deleted.')
                  void navigate('/customers')
                },
              })
            }
          >
            Delete customer
          </Button>
        </div>
      </Card>

      {editing && (
        <CustomerForm
          open
          customer={customer}
          existingCustomers={snapshot?.customers ?? []}
          defaultPriority={settings.defaultLeadPriority}
          onClose={() => setEditing(false)}
          onOpenCustomer={(id) => void navigate(`/customers/${id}`)}
          onSubmit={async (draft) => {
            await run((repository) => repository.updateCustomer(customer.id, draft))
            notify('success', 'Customer saved.')
          }}
        />
      )}

      {addingMethod && (
        <AddContactMethodDialog
          onClose={() => setAddingMethod(false)}
          onSubmit={async (method, value) => {
            await run((repository) =>
              repository.addContactMethod(customer.id, { method, value, isPrimary: false }),
            )
            notify('success', 'Contact method added.')
          }}
        />
      )}

      {addingVehicle && (
        <AddVehicleDialog
          onClose={() => setAddingVehicle(false)}
          onSubmit={async (draft) => {
            await run((repository) => repository.saveVehicleInterest(customer.id, draft))
            notify('success', 'Unit added.')
          }}
        />
      )}

      {confirming !== null && (
        <ConfirmDialog
          open
          title={confirming.title}
          message={confirming.message}
          confirmLabel={confirming.confirmLabel}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const action = confirming.onConfirm
            setConfirming(null)
            void action()
          }}
        />
      )}
    </div>
  )
}

function NoteBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="text-sm text-slate-300">{value ?? 'Nothing recorded'}</p>
    </div>
  )
}

function AddContactMethodDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (method: ContactMethod, value: string) => Promise<void>
}) {
  const [method, setMethod] = useState<ContactMethod>('phone_call')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (value.trim() === '') {
      setError('Enter a value.')
      return
    }

    try {
      await onSubmit(method, value)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the contact method.')
    }
  }

  return (
    <Modal
      open
      title="Add contact method"
      description="Availability only. Whether it has been tried is recorded by activities."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Channel"
          value={method}
          onChange={(event) => setMethod(event.target.value as ContactMethod)}
          options={CONTACT_METHODS.map((item) => ({ value: item, label: CONTACT_METHOD_LABELS[item] }))}
        />
        <TextField
          label="Value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="(555) 010-0100 or name@example.com"
          required
        />
        {error !== null && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

function AddVehicleDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (draft: {
    modelYear: number | null
    make: string
    model: string
    floorplan: string
    stockNumber: string
    condition: VehicleCondition
    isPrimary: boolean
  }) => Promise<void>
}) {
  const [modelYear, setModelYear] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [floorplan, setFloorplan] = useState('')
  const [stockNumber, setStockNumber] = useState('')
  const [condition, setCondition] = useState<VehicleCondition>('new')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    // The database rejects an interest with nothing identifying it.
    if ([make, model, floorplan, stockNumber, modelYear].every((field) => field.trim() === '')) {
      setError('Fill in at least one field so the unit can be identified.')
      return
    }

    try {
      await onSubmit({
        modelYear: modelYear.trim() === '' ? null : Number.parseInt(modelYear, 10),
        make,
        model,
        floorplan,
        stockNumber,
        condition,
        isPrimary: true,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the unit.')
    }
  }

  return (
    <Modal
      open
      title="Add vehicle interest"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()}>
            Add unit
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Year"
          type="number"
          value={modelYear}
          onChange={(event) => setModelYear(event.target.value)}
        />
        <TextField label="Make" value={make} onChange={(event) => setMake(event.target.value)} />
        <TextField label="Model" value={model} onChange={(event) => setModel(event.target.value)} />
        <TextField
          label="Floorplan"
          value={floorplan}
          onChange={(event) => setFloorplan(event.target.value)}
        />
        <TextField
          label="Stock number"
          value={stockNumber}
          onChange={(event) => setStockNumber(event.target.value)}
        />
        <SelectField
          label="Condition"
          value={condition}
          onChange={(event) => setCondition(event.target.value as VehicleCondition)}
          options={VEHICLE_CONDITIONS.map((value) => ({
            value,
            label: VEHICLE_CONDITION_LABELS[value],
          }))}
        />
        {error !== null && (
          <p role="alert" className="text-sm text-rose-300 sm:col-span-2">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}