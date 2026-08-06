import { useContext } from 'react'
import { WorkspaceContext, type WorkspaceContextValue } from './workspace-context.ts'

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)

  if (context === null) {
    throw new Error('useWorkspace must be used inside a WorkspaceProvider')
  }

  return context
}
