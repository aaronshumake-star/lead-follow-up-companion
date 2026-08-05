import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { cn } from '../../lib/cn.ts'
import { env } from '../../config/env.ts'
import { useAuth } from '../../features/auth/useAuth.ts'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/customers', label: 'Customers', end: false },
  { to: '/follow-ups', label: 'Follow-Ups', end: false },
  { to: '/screenshots', label: 'Screenshot Inbox', end: false },
  { to: '/whatsapp', label: 'WhatsApp', end: false },
  { to: '/settings', label: 'Settings', end: false },
] as const

export function AppShell() {
  const { user, isDemo, signOut } = useAuth()
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      {isDemo && (
        <div
          role="status"
          className="border-b border-amber-900/60 bg-amber-950/50 px-4 py-2 text-center text-sm text-amber-200"
        >
          Demo mode — these are fictional records stored in this browser only. They are not
          synchronized and never reach a Supabase project. Connect Supabase to use your own data.
        </div>
      )}

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-8">
        <header className="lg:w-56 lg:shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-slate-100">{env.VITE_APP_NAME}</p>
              <p className="text-xs text-slate-500">Nothing gets forgotten</p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-sm text-slate-300 lg:hidden"
              aria-expanded={navOpen}
              aria-controls="primary-navigation"
              onClick={() => setNavOpen((open) => !open)}
            >
              Menu
            </button>
          </div>

          <nav
            id="primary-navigation"
            aria-label="Primary"
            className={cn('mt-4 space-y-1', navOpen ? 'block' : 'hidden lg:block')}
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setNavOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-6 border-t border-slate-800 pt-4">
            <p className="truncate text-xs text-slate-500" title={user?.email ?? ''}>
              {user?.displayName ?? user?.email ?? 'Signed in'}
            </p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-2 rounded-lg border border-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-900"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
