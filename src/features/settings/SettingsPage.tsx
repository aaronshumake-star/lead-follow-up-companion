import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { PhaseNotice } from '../../components/ui/PhaseNotice.tsx'
import { DEMO_PROFILE } from '../../data/fixtures.ts'
import { describeProviders } from '../../providers/registry.ts'
import { isDemoMode, isSupabaseConfigured } from '../../config/env.ts'

export function SettingsPage() {
  const providers = describeProviders()

  const toggles: Array<{ label: string; enabled: boolean; note: string }> = [
    {
      label: 'WhatsApp notifications',
      enabled: DEMO_PROFILE.whatsappEnabled,
      note: 'Requires an approved number. Turning this off leaves the dashboard as the only surface.',
    },
    {
      label: 'Paid AI screenshot extraction',
      enabled: DEMO_PROFILE.aiExtractionEnabled,
      note: 'Off by default. Free in-browser OCR is used unless this is switched on.',
    },
    {
      label: 'Voice transcription',
      enabled: DEMO_PROFILE.voiceTranscriptionEnabled,
      note: 'Off by default. Billed per second of audio, so it stays off until needed.',
    },
    {
      label: 'Keep screenshots after extraction',
      enabled: DEMO_PROFILE.retainScreenshots,
      note: 'Off by default. Only the hash and extracted text are kept, which uses no storage quota.',
    },
    {
      label: 'Keep voice audio after transcription',
      enabled: DEMO_PROFILE.retainVoiceAudio,
      note: 'Off by default. Audio is deleted as soon as a transcript exists.',
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Provider wiring and the switches that decide whether this app can cost anything."
      />

      <PhaseNotice
        phase="Phase 1"
        summary="Values shown are read-only defaults. Editing arrives with the profile screen."
        planned={[
          'Approved WhatsApp number with a verification step',
          'Morning summary, overdue summary and quiet-hours times',
          'Monthly message and voice budgets with usage against them',
          'Retention switches for screenshots and voice audio',
        ]}
      />

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
          {toggles.map((toggle) => (
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
            <dd className="text-slate-200">{isDemoMode ? 'Fictional fixtures' : 'Your Supabase project'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Time zone</dt>
            <dd className="text-slate-200">{DEMO_PROFILE.timeZone}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Approved WhatsApp number</dt>
            <dd className="text-slate-200">{DEMO_PROFILE.whatsappNumberE164 ?? 'Not set'}</dd>
          </div>
        </dl>
      </Card>
    </div>
  )
}
