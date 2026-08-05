import { createContext } from 'react'
import type { Repository, StorageMode, WorkspaceSnapshot } from './workspace.ts'
import type { CustomerRow, Dashboard } from '../domain/dashboard.ts'
import type { UserSettings } from '../domain/settings.ts'

export type WorkspaceStatus = 'loading' | 'ready' | 'error'

export interface WorkspaceContextValue {
  status: WorkspaceStatus
  mode: StorageMode
  /** Safe to show: never contains customer data or provider internals. */
  error: string | null
  snapshot: WorkspaceSnapshot | null
  settings: UserSettings
  dashboard: Dashboard | null
  /** Every customer including archived ones, for the list page. */
  rows: CustomerRow[]
  rowsById: Map<string, CustomerRow>
  repository: Repository
  /** Re-reads the working set. Called after every mutation. */
  refresh(): Promise<void>
  /**
   * Runs a mutation, refreshes, and reports failure as a rejected promise so
   * the caller can show a message instead of leaving a half-applied UI.
   */
  run<T>(operation: (repository: Repository) => Promise<T>): Promise<T>
}

/** Split from the provider component so Fast Refresh keeps working. */
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
