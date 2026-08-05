import { Card } from './Card.tsx'

/**
 * Marks a page whose feature is intentionally not built yet, and says what will
 * land there. Better than an empty screen that looks broken.
 */
export function PhaseNotice({ phase, summary, planned }: { phase: string; summary: string; planned: string[] }) {
  return (
    <Card className="border-sky-900/60 bg-sky-950/20">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full border border-sky-800 bg-sky-950/60 px-2 py-0.5 text-xs font-medium text-sky-300">
          {phase}
        </span>
        <p className="text-sm text-slate-300">{summary}</p>
      </div>
      <ul className="mt-4 space-y-1.5 text-sm text-slate-400">
        {planned.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden className="text-slate-600">
              •
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
