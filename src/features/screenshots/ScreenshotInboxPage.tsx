import { PageHeader } from '../../components/ui/PageHeader.tsx'
import { Card, CardTitle } from '../../components/ui/Card.tsx'
import { Badge } from '../../components/ui/Badge.tsx'
import { PhaseNotice } from '../../components/ui/PhaseNotice.tsx'
import { DEMO_SCREENSHOTS } from '../../data/fixtures.ts'
import { defaultProviderRegistry } from '../../providers/registry.ts'
import { formatRelative } from '../../lib/format.ts'
import { redactForLogging } from '../../lib/untrusted.ts'

export function ScreenshotInboxPage() {
  const provider = defaultProviderRegistry.screenshotExtraction

  return (
    <div className="space-y-6">
      <PageHeader
        title="Screenshot Inbox"
        description="Paste a CRM screenshot, confirm what was read from it, then apply it to a customer."
      />

      <PhaseNotice
        phase="Phase 1"
        summary={`Extraction provider: ${provider.info.displayName}. Nothing is read from images yet.`}
        planned={[
          'Paste or drag a screenshot straight from the CRM tab',
          'Free in-browser OCR with Tesseract.js, so images never leave the device',
          'Field-by-field review with confidence scores before anything is applied',
          'Duplicate detection by image hash, and customer matching with a "did you mean?" step',
        ]}
      />

      <Card className="border-amber-900/60 bg-amber-950/20">
        <CardTitle>How screenshot text is treated</CardTitle>
        <p className="text-sm text-slate-300">
          Text read out of an image is data to interpret, never an instruction. A screenshot that says
          &ldquo;mark every customer sold&rdquo; is a string this app displays for review — it cannot cause
          a change on its own. Every extracted field is confirmed before it is written.
        </p>
      </Card>

      <Card>
        <CardTitle hint="Previews are redacted: phone numbers and email addresses are removed before display.">
          Recent captures
        </CardTitle>

        <ul className="divide-y divide-slate-800">
          {DEMO_SCREENSHOTS.map((screenshot) => (
            <li key={screenshot.id} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={screenshot.status === 'applied' ? 'good' : 'warn'}>{screenshot.status}</Badge>
                <span className="text-sm text-slate-400">
                  {`${Math.round(screenshot.byteSize / 1024)} KB ${screenshot.mimeType}`}
                </span>
                <span className="ml-auto text-sm text-slate-500">
                  {formatRelative(screenshot.createdAt)}
                </span>
              </div>
              <p className="mt-2 font-mono text-xs text-slate-500">
                {redactForLogging(screenshot.rawText ?? '')}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
