import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        'rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <header className="mb-3">
      <h2 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">{children}</h2>
      {hint !== undefined && <p className="mt-1 text-sm text-slate-400">{hint}</p>}
    </header>
  )
}

export function StatTile({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: number | string
  tone?: 'neutral' | 'alert' | 'warn' | 'good'
  hint?: string
}) {
  const toneClasses = {
    neutral: 'border-slate-800 bg-slate-900/60',
    alert: 'border-rose-900/70 bg-rose-950/40',
    warn: 'border-amber-900/70 bg-amber-950/30',
    good: 'border-emerald-900/70 bg-emerald-950/30',
  }[tone]

  return (
    <div className={cn('rounded-xl border p-4', toneClasses)}>
      <p className="text-3xl font-semibold tabular-nums text-slate-100">{value}</p>
      <p className="mt-1 text-sm font-medium text-slate-300">{label}</p>
      {hint !== undefined && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
