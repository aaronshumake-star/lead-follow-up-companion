import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Button } from '../../components/ui/Button.tsx'
import { cn } from '../../lib/cn.ts'
import { ALLOWED_MIME_TYPES, isAllowedDeclaredMime } from '../../lib/image.ts'
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

const FILE_ACCEPT = [...ALLOWED_MIME_TYPES, 'image/jpg', 'image/*'].join(',')

/**
 * Pulls image files from a FileList and/or DataTransferItemList.
 *
 * Some browsers put a dropped screenshot in `items` while leaving `files`
 * empty (or the reverse). Checking both is what stops a single-image drop
 * from silently doing nothing.
 */
function collectImageFiles(files: FileList | null | undefined, items?: DataTransferItemList | null): File[] {
  const collected: File[] = []
  const seen = new Set<string>()

  const push = (file: File | null | undefined) => {
    if (file === null || file === undefined) return
    // Empty MIME is allowed through — validateImage sniffs the bytes next.
    if (!isAllowedDeclaredMime(file.type) && !looksLikeImageFilename(file.name)) return
    const key = `${file.name}:${file.size}:${file.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    collected.push(file)
  }

  if (files !== null && files !== undefined) {
    for (let index = 0; index < files.length; index += 1) {
      push(files.item(index))
    }
  }

  if (items !== null && items !== undefined) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (item === undefined || item.kind !== 'file') continue
      push(item.getAsFile())
    }
  }

  return collected
}

function looksLikeImageFilename(name: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(name)
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
  const [localError, setLocalError] = useState<string | null>(null)
  const [localNotice, setLocalNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const busy =
    state.stage !== 'idle' &&
    state.stage !== 'done' &&
    state.stage !== 'error' &&
    state.stage !== 'cancelled'

  const submitFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        setLocalNotice(null)
        setLocalError('No image was found. Choose a PNG, JPEG or WEBP screenshot.')
        return
      }

      const first = files[0]
      if (first === undefined) {
        setLocalNotice(null)
        setLocalError('No image was found. Choose a PNG, JPEG or WEBP screenshot.')
        return
      }

      // One image enters the OCR path per submission. Extra selected files are
      // left for a follow-up choose/drop so an in-flight read is never replaced
      // mid-way — multi-image workflows still work one capture at a time.
      setLocalError(null)
      setLocalNotice(
        files.length > 1
          ? `Processing the first image (${first.name || 'screenshot'}). Choose or drop the next image when this finishes.`
          : null,
      )
      onFile(first, first.name === '' ? null : first.name)
    },
    [onFile],
  )

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const files = collectImageFiles(event.clipboardData?.files, event.clipboardData?.items)
      if (files.length === 0) {
        // A paste with no image at all is ordinary text — leave it alone.
        const hasFileItem = [...(event.clipboardData?.items ?? [])].some((item) => item.kind === 'file')
        if (hasFileItem) {
          event.preventDefault()
          setLocalNotice(null)
          setLocalError('That paste was not a PNG, JPEG or WEBP image.')
        }
        return
      }

      event.preventDefault()
      const named = files.map((file) =>
        file.name === '' ? new File([file], 'pasted-screenshot.png', { type: file.type }) : file,
      )
      submitFiles(named)
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [submitFiles])

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    submitFiles(collectImageFiles(event.dataTransfer.files, event.dataTransfer.items))
  }

  const displayError = localError ?? state.error
  const showStatus =
    state.previewUrl !== null || busy || displayError !== null || localNotice !== null

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
            <Button
              variant="ghost"
              onClick={() => {
                setLocalError(null)
                setLocalNotice(null)
                onReset()
              }}
            >
              Clear
            </Button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          className="sr-only"
          aria-label="Choose a screenshot file"
          onChange={(event) => {
            submitFiles(collectImageFiles(event.target.files))
            event.target.value = ''
          }}
        />
      </div>

      {showStatus && (
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

            {localNotice !== null && displayError === null && (
              <p className="mt-2 text-sm text-slate-400" role="status">
                {localNotice}
              </p>
            )}

            {displayError !== null && (
              <p role="alert" className="mt-2 text-sm text-rose-300">
                {displayError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
