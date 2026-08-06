import type { ReactNode } from 'react'
import { Card } from './Card.tsx'
import { Button } from './Button.tsx'

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-12 text-slate-400">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400"
      />
      {label}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-rose-900/70 bg-rose-950/20">
      <div role="alert" className="space-y-3">
        <p className="text-sm font-medium text-rose-200">Something went wrong</p>
        <p className="text-sm text-slate-300">{message}</p>
        {onRetry !== undefined && (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </Card>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {description !== undefined && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      {action !== undefined && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
