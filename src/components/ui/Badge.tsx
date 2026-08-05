import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

export type BadgeTone = 'neutral' | 'info' | 'good' | 'warn' | 'alert'

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'border-slate-700 bg-slate-800/70 text-slate-300',
  info: 'border-sky-800 bg-sky-950/60 text-sky-300',
  good: 'border-emerald-800 bg-emerald-950/60 text-emerald-300',
  warn: 'border-amber-800 bg-amber-950/60 text-amber-300',
  alert: 'border-rose-800 bg-rose-950/60 text-rose-300',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  )
}
