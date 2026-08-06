import { useState } from 'react'
import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { SelectField, TextField } from '../../components/ui/Field.tsx'
import { EmptyState } from '../../components/ui/States.tsx'
import { useWorkspace } from '../../data/useWorkspace.ts'
import { useToast } from '../../components/ui/useToast.ts'
import { VOICE_SCENARIOS } from '../../domain/voice/scenarios.ts'
import { DEMO_APPROVED_NUMBER } from '../../data/demo/import-runtime.ts'
import { formatRelative } from '../../lib/format.ts'

export function VoiceNotesSection() {
  const { snapshot, mode, run } = useWorkspace()
  const { notify } = useToast()
  const [scenario, setScenario] = useState('call_no_answer')
  const [from, setFrom] = useState(DEMO_APPROVED_NUMBER)
  const [reply, setReply] = useState<string | null>(null)
  const records = snapshot?.voiceRecords ?? []

  async function simulate() {
    const result = await run((repo) =>
      repo.simulateVoiceMessage?.(scenario, from) ??
      Promise.resolve({ accepted: false, reply: 'Voice simulation is unavailable.', voiceRecordId: null }),
    )
    setReply(result.accepted ? result.reply : (result.rejectionReason ?? 'Rejected.'))
    notify(result.accepted ? 'success' : 'error', result.accepted ? 'Voice note processed.' : 'Voice note rejected.')
  }

  return (
    <Card>
      <CardTitle hint="Audio is deleted immediately after successful transcription by default.">
        Voice Notes
      </CardTitle>

      {mode === 'demo' && (
        <div className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
          <p className="text-sm text-slate-300">
            Simulated only — no media is downloaded and no paid transcription API is called.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Voice scenario"
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
              options={VOICE_SCENARIOS.map((item) => ({ value: item.id, label: item.label }))}
            />
            <TextField label="From number" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={() => void simulate()}>Simulate voice note</Button>
            <Button
              variant="ghost"
              onClick={() => setFrom(from === DEMO_APPROVED_NUMBER ? '+15550100777' : DEMO_APPROVED_NUMBER)}
            >
              {from === DEMO_APPROVED_NUMBER ? 'Use unknown sender' : 'Use approved sender'}
            </Button>
          </div>
          {reply !== null && (
            <pre data-testid="voice-reply" className="mt-3 rounded-lg bg-slate-900 p-3 font-sans text-sm whitespace-pre-wrap">
              {reply}
            </pre>
          )}
        </div>
      )}

      {records.length === 0 ? (
        <EmptyState title="No voice notes received" />
      ) : (
        <ul className="divide-y divide-slate-800">
          {records.slice().reverse().map((record) => (
            <li key={record.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={record.status === 'applied' ? 'good' : record.status === 'failed' ? 'alert' : 'warn'}>
                  {record.status.replace(/_/g, ' ')}
                </Badge>
                {record.simulated && <Badge>simulated</Badge>}
                <span className="text-sm text-slate-300">{record.parsedIntent ?? 'Not parsed'}</span>
                <span className="ml-auto text-xs text-slate-500">{formatRelative(record.createdAt)}</span>
              </div>
              {record.transcriptPreview !== null && (
                <p className="mt-2 text-sm text-slate-300">“{record.transcriptPreview}”</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                {record.transcriptionProvider ?? 'No provider'} · {record.durationSeconds ?? 0}s ·{' '}
                {record.audioDeletedAt !== null ? 'audio deleted' : record.audioRetained ? 'audio retained temporarily' : 'no audio retained'}
              </p>
              {record.failureSummary !== null && <p className="mt-1 text-sm text-rose-300">{record.failureSummary}</p>}
              <div className="mt-2 flex gap-2">
                {record.nextAttemptAt !== null && (
                  <Button
                    size="sm"
                    onClick={() =>
                      void run((repo) => repo.retryVoiceMessage?.(record.id) ?? Promise.resolve(null)).then(() =>
                        notify('success', 'Safe retry completed.'),
                      )
                    }
                  >
                    Retry safe failure
                  </Button>
                )}
                {record.audioRetained && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      void run((repo) => repo.deleteRetainedAudio?.(record.id) ?? Promise.resolve()).then(() =>
                        notify('success', 'Retained audio deleted.'),
                      )
                    }
                  >
                    Delete retained audio
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
