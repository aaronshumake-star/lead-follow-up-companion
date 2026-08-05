import { useEffect, useState } from 'react'
import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx'
import { ErrorState, LoadingState } from '../../components/ui/States.tsx'
import { SelectField, TextField } from '../../components/ui/Field.tsx'
import { useToast } from '../../components/ui/useToast.ts'
import { useWorkspace } from '../../data/useWorkspace.ts'
import { describeProviders } from '../../providers/registry.ts'
import { isDemoMode, isSupabaseConfigured } from '../../config/env.ts'
import { DEFAULT_SETTINGS, validateSettings, type UserSettings } from '../../domain/settings.ts'
import { LEAD_PRIORITIES, LEAD_PRIORITY_LABELS } from '../../domain/vocabulary.ts'
import type { LeadPriority } from '../../domain/vocabulary.ts'
import type { DateTimeDisplay } from '../../domain/models.ts'

/**
 * Common IANA zones for the dealership's region. Any other zone can still be
 * typed, and validateSettings rejects one the runtime does not recognise.
 */
const TIME_ZONES = [
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
]

const HOUR_FIELDS: Array<{ key: keyof UserSettings; label: string; hint: string }> = [
  { key: 'noAnswerFollowUpHours', label: 'Call with no answer', hint: 'Hours until the retry is due' },
  { key: 'voicemailFollowUpHours', label: 'Voicemail left', hint: 'Hours before chasing again' },
  { key: 'textNoReplyFollowUpHours', label: 'Text with no reply', hint: 'Hours before following up' },
  { key: 'emailNoReplyFollowUpHours', label: 'Email with no reply', hint: 'Hours before following up' },
  { key: 'quoteSentFollowUpHours', label: 'Quote sent', hint: 'Hours before checking back' },
  {
    key: 'waitingTimeoutHours',
    label: 'Waiting for customer',
    hint: 'Hours before the lead returns to Action required',
  },
]

export function SettingsPage() {
  const { status, error, settings, snapshot, mode, run, refresh, repository } = useWorkspace()
  const { notify } = useToast()

  const [draft, setDraft] = useState<UserSettings>(settings)
  const [errors, setErrors] = useState<Partial<Record<keyof UserSettings, string>>>({})
  const [saving, setSaving] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  // Reset the form whenever the stored settings change under it.
  useEffect(() => setDraft(settings), [settings])

  if (status === 'loading') return <LoadingState label="Loading settings…" />
  if (status === 'error') {
    return <ErrorState message={error ?? 'Could not load settings.'} onRetry={() => void refresh()} />
  }

  const providers = describeProviders()
  const profile = snapshot?.profile

  function set<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    const result = validateSettings(draft, settings)
    setErrors(result.errors)

    if (Object.keys(result.errors).length > 0) {
      notify('error', 'Some settings were not valid and kept their previous values.')
      setDraft(result.settings)
      return
    }

    setSaving(true)
    try {
      await run((repo) => repo.updateSettings(result.settings))
      notify('success', 'Settings saved.')
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'Could not save your settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Scheduling defaults, provider wiring, and the switches that decide whether this app can cost anything."
        actions={
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        }
      />

      <Card>
        <CardTitle hint="Follow-up times are resolved in this zone, not the browser's.">
          Time and display
        </CardTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Time zone"
            value={TIME_ZONES.includes(draft.timeZone) ? draft.timeZone : TIME_ZONES[0]}
            onChange={(event) => set('timeZone', event.target.value)}
            options={TIME_ZONES.map((zone) => ({ value: zone, label: zone }))}
            error={errors.timeZone}
          />
          <TextField
            label="Morning time"
            type="time"
            value={draft.morningAt}
            onChange={(event) => set('morningAt', event.target.value)}
            hint='Used by "tomorrow morning"'
            error={errors.morningAt}
          />
          <TextField
            label="Afternoon time"
            type="time"
            value={draft.afternoonAt}
            onChange={(event) => set('afternoonAt', event.target.value)}
            hint='Used by "tomorrow afternoon"'
            error={errors.afternoonAt}
          />
          <SelectField
            label="Date and time display"
            value={draft.dateTimeDisplay}
            onChange={(event) => set('dateTimeDisplay', event.target.value as DateTimeDisplay)}
            options={[
              { value: 'relative', label: 'Relative (in 3 hours)' },
              { value: 'absolute', label: 'Absolute (Aug 6, 10:00 AM)' },
              { value: 'both', label: 'Both' },
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardTitle hint="Every quick action uses these, so changing one changes the whole workflow.">
          Follow-up defaults
        </CardTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HOUR_FIELDS.map((field) => (
            <TextField
              key={String(field.key)}
              label={field.label}
              type="number"
              min={1}
              max={8760}
              value={String(draft[field.key])}
              onChange={(event) =>
                set(field.key, Number.parseInt(event.target.value, 10) as UserSettings[typeof field.key])
              }
              hint={field.hint}
              error={errors[field.key]}
            />
          ))}
          <SelectField
            label="Default lead priority"
            value={draft.defaultLeadPriority}
            onChange={(event) => set('defaultLeadPriority', event.target.value as LeadPriority)}
            options={LEAD_PRIORITIES.map((value) => ({ value, label: LEAD_PRIORITY_LABELS[value] }))}
          />
        </div>
      </Card>

      {mode === 'demo' && (
        <Card className="border-amber-900/60 bg-amber-950/20">
          <CardTitle hint="Demo records live in this browser only and are never sent anywhere.">
            Demo data
          </CardTitle>
          <p className="text-sm text-slate-300">
            You are working with local fictional records. Resetting discards everything you have changed
            and reloads the original fixtures.
          </p>
          <Button className="mt-3" variant="danger" onClick={() => setConfirmingReset(true)}>
            Reset demo data
          </Button>
        </Card>
      )}

      <Card>
        <CardTitle hint="Every external capability sits behind an interface and can be swapped.">
          Providers
        </CardTitle>
        <ul className="divide-y divide-slate-800">
          {providers.map(({ slot, label, info }) => (
            <li key={slot} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-48 font-medium text-slate-200">{label}</span>
              <Badge tone={info.isConfigured ? 'good' : 'neutral'}>{info.displayName}</Badge>
              <Badge tone={info.isBillable ? 'warn' : 'good'}>
                {info.isBillable ? 'can bill' : 'no cost'}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle hint="Anything that can cost money starts switched off.">Cost switches</CardTitle>
        <ul className="divide-y divide-slate-800">
          {[
            {
              label: 'WhatsApp notifications',
              enabled: profile?.whatsappEnabled ?? false,
              note: 'Requires an approved number. Arrives in Phase 3.',
            },
            {
              label: 'Paid AI screenshot extraction',
              enabled: profile?.aiExtractionEnabled ?? false,
              note: 'Off by default. Free in-browser OCR is used unless this is switched on.',
            },
            {
              label: 'Voice transcription',
              enabled: profile?.voiceTranscriptionEnabled ?? false,
              note: 'Off by default. Billed per second of audio.',
            },
            {
              label: 'Keep screenshots after extraction',
              enabled: profile?.retainScreenshots ?? false,
              note: 'Off by default. Only the hash and extracted text are kept.',
            },
            {
              label: 'Keep voice audio after transcription',
              enabled: profile?.retainVoiceAudio ?? false,
              note: 'Off by default. Audio is deleted once a transcript exists.',
            },
          ].map((toggle) => (
            <li key={toggle.label} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-slate-200">{toggle.label}</span>
                <Badge tone={toggle.enabled ? 'good' : 'neutral'}>{toggle.enabled ? 'On' : 'Off'}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">{toggle.note}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>Connection</CardTitle>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-400">Supabase</dt>
            <dd className="text-slate-200">
              {isSupabaseConfigured ? 'Configured' : 'Not configured — see README.md'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Data source</dt>
            <dd className="text-slate-200">
              {isDemoMode ? 'Local fictional records' : 'Your Supabase project'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Time zone in use</dt>
            <dd className="text-slate-200">{settings.timeZone}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Approved WhatsApp number</dt>
            <dd className="text-slate-200">{profile?.whatsappNumberE164 ?? 'Not set'}</dd>
          </div>
        </dl>
      </Card>

      <ConfirmDialog
        open={confirmingReset}
        title="Reset demo data"
        message="Discard every local demo record and reload the original fictional customers? This cannot be undone."
        confirmLabel="Reset demo data"
        onCancel={() => setConfirmingReset(false)}
        onConfirm={() => {
          setConfirmingReset(false)
          void (async () => {
            await repository.resetDemoData?.()
            await refresh()
            notify('success', 'Demo data reset.')
          })()
        }}
      />
    </div>
  )
}

/** Exported so tests can assert the shipped defaults without duplicating them. */
export const SETTINGS_DEFAULTS = DEFAULT_SETTINGS
