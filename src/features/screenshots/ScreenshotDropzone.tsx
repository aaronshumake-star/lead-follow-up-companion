import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Button } from '../../components/ui/Button.tsx'
import { cn } from '../../lib/cn.ts'
import { ALLOWED_MIME_TYPES } from '../../lib/image.ts'
import type { IntakeState } from './useScreenshotIntake.ts'

const STAGE_LABELS: Record<IntakeState['stage'], string> = {
  idle: '',
  validating: 'Checking the image…',
  hashing: 'Looking for a duplicate…',
  extracting: 'Reading the screenshot…',
  deciding: 'Matching the customer…',
  applying: 'Saving…',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled',
}

/**
 * The intake surface: paste, drag, or pick a file.
 *
 * Paste is the primary path — the whole workflow is "screenshot the CRM, switch
 * tab, Ctrl+V" — so the listener is on the document rather than a focused
 * element, and works wherever you are on the page.
 */
export function ScreenshotDropzone({
  state,
  onFile,
  onCancel,
  onReset,
}: {
  state: IntakeState
  onFile: (blob: Blob, filename: string | null) => void
  onCancel: () => void
  onReset: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const busy =
    state.stage !== 'idle' &&
    state.stage !== 'done' &&
    state.stage !== 'error' &&
    state.stage !== 'cancelled'

  const handleFile = useCallback(
    (file: File | Blob | null, name: string | null) => {
      if (file === null) return
      onFile(file, name)
    },
    [onFile],
  )

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items
      if (items === undefined) return

      for (const item of items) {
        if (item.kind !== 'file') continue

        const file = item.getAsFile()
        if (file === null) continue
        if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) continue

        event.preventDefault()
        handleFile(file, file.name === '' ? 'pasted-screenshot.png' : file.name)
        return
      }
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [handleFile])

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)

    const file = event.dataTransfer.files.item(0)
    handleFile(file, file?.name ?? null)
  }

  return (
    <div
      data-testid="screenshot-dropzone"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'rounded-xl border-2 border-dashed p-6 transition-colors',
        dragging ? 'border-sky-500 bg-sky-950/30' : 'border-slate-700 bg-slate-900/40',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-200">
            Paste a screenshot with Ctrl+V, drag one here, or choose a file
          </p>
          <p className="mt-1 text-xs text-slate-500">
            PNG, JPEG or WEBP, up to 10 MB. Images are read on this device and are not uploaded.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
            Choose file
          </Button>
          {busy && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {(state.stage === 'done' || state.stage === 'error' || state.stage === 'cancelled') && (
            <Button variant="ghost" onClick={onReset}>
              Clear
            </Button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_MIME_TYPES.join(',')}
          className="sr-only"
          aria-label="Choose a screenshot file"
          onChange={(event) => {
            const file = event.target.files?.item(0) ?? null
            handleFile(file, file?.name ?? null)
            event.target.value = ''
          }}
        />
      </div>

      {(state.previewUrl !== null || busy) && (
        <div className="mt-4 flex flex-wrap items-start gap-4 border-t border-slate-800 pt-4">
          {state.previewUrl !== null && (
            <img
              src={state.previewUrl}
              alt="Screenshot preview"
              className="max-h-40 rounded-lg border border-slate-800"
            />
          )}

          <div className="min-w-56 flex-1">
            <p className="text-sm text-slate-300" role="status" aria-live="polite">
              {STAGE_LABELS[state.stage]}
              {state.filename !== null && (
                <span className="ml-2 text-xs text-slate-500">{state.filename}</span>
              )}
            </p>

            {busy && (
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(state.progress * 100)}
                aria-label="Extraction progress"
              >
                <div
                  className="h-full rounded-full bg-sky-500 transition-all"
                  style={{ width: `${Math.max(5, Math.round(state.progress * 100))}%` }}
                />
              </div>
            )}

            {state.error !== null && (
              <p role="alert" className="mt-2 text-sm text-rose-300">
                {state.error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
