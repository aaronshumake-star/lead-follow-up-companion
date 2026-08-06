import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { Button } from './ui/Button.tsx'

/** One update prompt per deployment; reload only after explicit user action. */
export function AppUpdateNotice() {
  const [update, setUpdate] = useState<null | (() => Promise<void>)>(null)

  useEffect(() => {
    const apply = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdate(() => async () => {
          await apply(true)
          window.location.reload()
        })
      },
    })
  }, [])

  if (update === null) return null

  return (
    <div className="fixed right-4 bottom-4 z-50 max-w-sm rounded-lg border border-sky-700 bg-slate-900 p-4 shadow-xl">
      <p className="text-sm text-slate-100">A new version is ready.</p>
      <p className="mt-1 text-xs text-slate-400">Reload once to use it. Your unsaved form stays untouched until then.</p>
      <Button className="mt-3" size="sm" variant="primary" onClick={() => void update()}>
        Reload and update
      </Button>
    </div>
  )
}
