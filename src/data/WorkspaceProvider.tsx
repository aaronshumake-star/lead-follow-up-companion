import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isDemoMode } from '../config/env.ts'
import { getSupabaseClient } from '../lib/supabase/client.ts'
import { useAuth } from '../features/auth/useAuth.ts'
import { buildDashboard } from '../domain/dashboard.ts'
import { DEFAULT_SETTINGS, settingsFromProfile } from '../domain/settings.ts'
import { DemoRepository } from './demo/demo-repository.ts'
import { SupabaseRepository } from './supabase/supabase-repository.ts'
import { WorkspaceContext, type WorkspaceContextValue, type WorkspaceStatus } from './workspace-context.ts'
import type { Repository, WorkspaceSnapshot } from './workspace.ts'

/**
 * Loads the working set once and keeps it in sync after every change.
 *
 * The whole set is held in memory and every queue is derived from it by the
 * tested domain functions, so the dashboard, the customer list and the detail
 * page can never disagree about what state a lead is in.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const supabase = getSupabaseClient()

  const repository = useMemo<Repository>(() => {
    // Demo and Supabase are mutually exclusive, so a local demo record can
    // never be written to a real project.
    if (isDemoMode || supabase === null || user === null) return new DemoRepository()
    return new SupabaseRepository(supabase, user.id)
  }, [supabase, user])

  const [status, setStatus] = useState<WorkspaceStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)

  // Guards against a slow first load overwriting a newer one after a refresh.
  const loadToken = useRef(0)

  const refresh = useCallback(async () => {
    const token = ++loadToken.current

    try {
      // Waiting deadlines are evaluated on load, so a lapsed one returns to the
      // action queue without needing a background scheduler. Phase 3 will call
      // the same operation from a schedule.
      await repository.expireWaitingFollowUps(new Date())
      const next = await repository.load()

      if (token !== loadToken.current) return
      setSnapshot(next)
      setError(null)
      setStatus('ready')
    } catch (cause) {
      if (token !== loadToken.current) return
      setSnapshot(null)
      setError(messageFor(cause))
      setStatus('error')
    }
  }, [repository])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(
    async <T,>(operation: (repository: Repository) => Promise<T>): Promise<T> => {
      const result = await operation(repository)
      await refresh()
      return result
    },
    [repository, refresh],
  )

  const settings = useMemo(
    () => (snapshot === null ? DEFAULT_SETTINGS : settingsFromProfile(snapshot.profile)),
    [snapshot],
  )

  const dashboard = useMemo(() => {
    if (snapshot === null) return null

    return buildDashboard({
      customers: snapshot.customers,
      contactMethods: snapshot.contactMethods,
      vehicleInterests: snapshot.vehicleInterests,
      activities: snapshot.activities,
      followUps: snapshot.followUps,
      timeZone: settings.timeZone,
    })
  }, [snapshot, settings.timeZone])

  // Memoized on the dashboard rather than on the derived array, which would be
  // a new reference every render and defeat the memo.
  const rows = useMemo(() => dashboard?.rows ?? [], [dashboard])
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.customer.id, row])), [rows])

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      status,
      mode: repository.mode,
      error,
      snapshot,
      settings,
      dashboard,
      rows,
      rowsById,
      repository,
      refresh,
      run,
    }),
    [status, repository, error, snapshot, settings, dashboard, rows, rowsById, refresh, run],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

/**
 * Error text safe to render. Repository errors are already written for humans;
 * anything else is replaced rather than risking provider internals on screen.
 */
function messageFor(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') return cause.message
  return 'Something went wrong loading your customers.'
}
