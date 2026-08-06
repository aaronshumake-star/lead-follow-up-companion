import { useMemo, useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import {
  CONTACT_METHODS,
  CONTACT_METHOD_LABELS,
  LEAD_PRIORITIES,
  LEAD_PRIORITY_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  LEAD_TEMPERATURES,
  LEAD_TEMPERATURE_LABELS,
  PREFERRED_LANGUAGES,
  PREFERRED_LANGUAGE_LABELS,
} from '../../domain/vocabulary.ts'
import type {
  ContactMethod,
  LeadPriority,
  LeadStatus,
  LeadTemperature,
  PreferredLanguage,
} from '../../domain/vocabulary.ts'
import { findDuplicateCandidates, type DuplicateCandidate } from '../../domain/duplicates.ts'
import { DuplicateWarning } from './DuplicateWarning.tsx'
import type { Customer } from '../../domain/models.ts'
import type { CustomerDraft } from '../../data/workspace.ts'

interface FormState {
  fullName: string
  firstName: string
  lastName: string
  primaryPhone: string
  primaryEmail: string
  dealershipCustomerId: string
  city: string
  state: string
  preferredLanguage: PreferredLanguage
  preferredContactMethod: ContactMethod | ''
  salesperson: string
  leadSource: string
  leadPriority: LeadPriority
  leadTemperature: LeadTemperature
  leadStatus: LeadStatus
  notes: string
  pinnedNote: string
  objections: string
  tradeNotes: string
  financeStatus: string
}

function initialState(customer: Customer | null, defaultPriority: LeadPriority): FormState {
  return {
    fullName: customer?.fullName ?? '',
    firstName: customer?.firstName ?? '',
    lastName: customer?.lastName ?? '',
    primaryPhone: customer?.primaryPhone ?? '',
    primaryEmail: customer?.primaryEmail ?? '',
    dealershipCustomerId: customer?.dealershipCustomerId ?? '',
    city: customer?.city ?? '',
    state: customer?.state ?? '',
    preferredLanguage: customer?.preferredLanguage ?? 'unknown',
    preferredContactMethod: customer?.preferredContactMethod ?? '',
    salesperson: customer?.salesperson ?? '',
    leadSource: customer?.leadSource ?? '',
    leadPriority: customer?.leadPriority ?? defaultPriority,
    leadTemperature: customer?.leadTemperature ?? 'unknown',
    leadStatus: customer?.leadStatus ?? 'new',
    notes: customer?.notes ?? '',
    pinnedNote: customer?.pinnedNote ?? '',
    objections: customer?.objections ?? '',
    tradeNotes: customer?.tradeNotes ?? '',
    financeStatus: customer?.financeStatus ?? '',
  }
}

/**
 * Create and edit form.
 *
 * On create, possible duplicates are surfaced before saving — never merged.
 * The operator can open the existing record or deliberately continue, because
 * two people really can share a household phone.
 */
export function CustomerForm({
  open,
  customer,
  existingCustomers,
  defaultPriority,
  onSubmit,
  onClose,
  onOpenCustomer,
}: {
  open: boolean
  customer: Customer | null
  existingCustomers: readonly Customer[]
  defaultPriority: LeadPriority
  onSubmit: (draft: CustomerDraft) => Promise<void>
  onClose: () => void
  onOpenCustomer: (customerId: string) => void
}) {
  const [form, setForm] = useState<FormState>(() => initialState(customer, defaultPriority))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false)

  const isEditing = customer !== null

  const duplicates = useMemo<DuplicateCandidate[]>(() => {
    if (form.fullName.trim() === '') return []

    return findDuplicateCandidates(
      {
        fullName: form.fullName,
        primaryPhone: form.primaryPhone,
        primaryEmail: form.primaryEmail,
        dealershipCustomerId: form.dealershipCustomerId,
        city: form.city,
      },
      existingCustomers,
      customer?.id,
    )
  }, [form, existingCustomers, customer])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setDuplicatesAcknowledged(false)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (form.fullName.trim() === '') {
      setError('A full name is required.')
      return
    }

    if (form.state !== '' && !/^[A-Za-z]{2}$/.test(form.state.trim())) {
      setError('Use a two-letter state code, or leave it blank.')
      return
    }

    if (form.primaryEmail !== '' && !form.primaryEmail.includes('@')) {
      setError('Enter a valid email address, or leave it blank.')
      return
    }

    // The warning is shown once and can be overridden deliberately.
    if (!isEditing && duplicates.length > 0 && !duplicatesAcknowledged) {
      setDuplicatesAcknowledged(true)
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        fullName: form.fullName,
        firstName: form.firstName,
        lastName: form.lastName,
        primaryPhone: form.primaryPhone,
        primaryEmail: form.primaryEmail,
        dealershipCustomerId: form.dealershipCustomerId,
        city: form.city,
        state: form.state,
        preferredLanguage: form.preferredLanguage,
        preferredContactMethod: form.preferredContactMethod === '' ? null : form.preferredContactMethod,
        salesperson: form.salesperson,
        leadSource: form.leadSource,
        leadPriority: form.leadPriority,
        leadTemperature: form.leadTemperature,
        leadStatus: form.leadStatus,
        notes: form.notes,
        pinnedNote: form.pinnedNote,
        objections: form.objections,
        tradeNotes: form.tradeNotes,
        financeStatus: form.financeStatus,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the customer.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={isEditing ? `Edit ${customer.fullName}` : 'New customer'}
      description={
        isEditing
          ? 'Changes are saved to this record only.'
          : 'A phone or email entered here is also added as a contact method.'
      }
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="customer-form" disabled={submitting}>
            {submitting
              ? 'Saving…'
              : !isEditing && duplicates.length > 0 && !duplicatesAcknowledged
                ? 'Check for duplicates'
                : isEditing
                  ? 'Save changes'
                  : 'Create customer'}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
        {!isEditing && duplicatesAcknowledged && duplicates.length > 0 && (
          <DuplicateWarning
            candidates={duplicates}
            onOpenCustomer={(id) => {
              onOpenCustomer(id)
              onClose()
            }}
          />
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField
              label="Full name"
              value={form.fullName}
              onChange={(event) => set('fullName', event.target.value)}
              required
              autoFocus
            />
          </div>

          <TextField
            label="First name"
            value={form.firstName}
            onChange={(event) => set('firstName', event.target.value)}
          />
          <TextField
            label="Last name"
            value={form.lastName}
            onChange={(event) => set('lastName', event.target.value)}
          />
          <TextField
            label="Phone"
            type="tel"
            value={form.primaryPhone}
            onChange={(event) => set('primaryPhone', event.target.value)}
            placeholder="(555) 010-0100"
          />
          <TextField
            label="Email"
            type="email"
            value={form.primaryEmail}
            onChange={(event) => set('primaryEmail', event.target.value)}
          />
          <TextField
            label="Dealership customer ID"
            value={form.dealershipCustomerId}
            onChange={(event) => set('dealershipCustomerId', event.target.value)}
            hint="The CRM's own identifier, if you have it."
          />
          <TextField
            label="Lead source"
            value={form.leadSource}
            onChange={(event) => set('leadSource', event.target.value)}
          />
          <TextField
            label="City"
            value={form.city}
            onChange={(event) => set('city', event.target.value)}
          />
          <TextField
            label="State"
            value={form.state}
            onChange={(event) => set('state', event.target.value)}
            maxLength={2}
            placeholder="TX"
          />
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Status"
            value={form.leadStatus}
            onChange={(event) => set('leadStatus', event.target.value as LeadStatus)}
            options={LEAD_STATUSES.map((value) => ({ value, label: LEAD_STATUS_LABELS[value] }))}
          />
          <SelectField
            label="Priority"
            value={form.leadPriority}
            onChange={(event) => set('leadPriority', event.target.value as LeadPriority)}
            options={LEAD_PRIORITIES.map((value) => ({ value, label: LEAD_PRIORITY_LABELS[value] }))}
          />
          <SelectField
            label="Temperature"
            value={form.leadTemperature}
            onChange={(event) => set('leadTemperature', event.target.value as LeadTemperature)}
            options={LEAD_TEMPERATURES.map((value) => ({
              value,
              label: LEAD_TEMPERATURE_LABELS[value],
            }))}
          />
          <SelectField
            label="Preferred language"
            value={form.preferredLanguage}
            onChange={(event) => set('preferredLanguage', event.target.value as PreferredLanguage)}
            options={PREFERRED_LANGUAGES.map((value) => ({
              value,
              label: PREFERRED_LANGUAGE_LABELS[value],
            }))}
          />
          <SelectField
            label="Preferred contact method"
            value={form.preferredContactMethod}
            onChange={(event) => set('preferredContactMethod', event.target.value as ContactMethod | '')}
            options={[
              { value: '', label: 'Not stated' },
              ...CONTACT_METHODS.map((value) => ({ value, label: CONTACT_METHOD_LABELS[value] })),
            ]}
            hint="What they asked for. Not a record of what has been tried."
          />
          <TextField
            label="Salesperson"
            value={form.salesperson}
            onChange={(event) => set('salesperson', event.target.value)}
          />
        </section>

        <section className="space-y-4">
          <TextField
            label="Pinned note"
            value={form.pinnedNote}
            onChange={(event) => set('pinnedNote', event.target.value)}
            hint="Shown on the card and the detail header. Keep it short."
            maxLength={500}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAreaField
              label="Objections"
              value={form.objections}
              onChange={(event) => set('objections', event.target.value)}
            />
            <TextAreaField
              label="Trade information"
              value={form.tradeNotes}
              onChange={(event) => set('tradeNotes', event.target.value)}
            />
            <TextAreaField
              label="Finance status"
              value={form.financeStatus}
              onChange={(event) => set('financeStatus', event.target.value)}
            />
            <TextAreaField
              label="General notes"
              value={form.notes}
              onChange={(event) => set('notes', event.target.value)}
            />
          </div>
        </section>

        {!isEditing && duplicates.length > 0 && !duplicatesAcknowledged && (
          <p className="text-sm text-amber-300">
            <Badge tone="warn">{`${duplicates.length} possible duplicate`}</Badge>{' '}
            Saving will show the matches first so you can decide.
          </p>
        )}

        {error !== null && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
