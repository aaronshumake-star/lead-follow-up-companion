import { useCallback, useRef, useState } from 'react'
import { useWorkspace } from '../../data/useWorkspace.ts'
import { useToast } from '../../components/ui/useToast.ts'
import { measureImageInBrowser, validateImage, type ValidatedImage } from '../../lib/image.ts'
import { createFixtureExtractionProvider } from '../../providers/screenshot-extraction/fixture.ts'
import { createTesseractExtractionProvider } from '../../providers/screenshot-extraction/tesseract.ts'
import { parseUntrustedOcr } from '../../domain/screenshot/parse-ocr.ts'
import { emptyExtraction } from '../../domain/screenshot/extraction.ts'
import { decideImport } from '../../domain/screenshot/decision-engine.ts'
import type { ImportOutcome } from '../../data/workspace.ts'
import { readUntrusted } from '../../lib/untrusted.ts'

export type IntakeStage =
  | 'idle'
  | 'validating'
  | 'hashing'
  | 'extracting'
  | 'deciding'
  | 'applying'
  | 'done'
  | 'error'
  | 'cancelled'

export interface IntakeState {
  stage: IntakeStage
  /** 0–1 while OCR is running. */
  progress: number
  previewUrl: string | null
  filename: string | null
  error: string | null
  outcome: ImportOutcome | null
}

const IDLE: IntakeState = {
  stage: 'idle',
  progress: 0,
  previewUrl: null,
  filename: null,
  error: null,
  outcome: null,
}

/**
 * Drives one screenshot from paste to applied record.
 *
 * The whole pipeline runs in the browser: validate, hash, check for a
 * duplicate, OCR, decide, then write. Nothing is uploaded, which is why
 * extraction costs nothing and why the image never has to be retained.
 *
 * Cancel is honoured between every stage, and a failure at any point leaves a
 * message rather than a half-applied record.
 */
export function useScreenshotIntake(options: { scenarioId?: string | null } = {}) {
  const { repository, snapshot, settings, run, mode } = useWorkspace()
  const { notify } = useToast()

  const [state, setState] = useState<IntakeState>(IDLE)
  const cancelRef = useRef<AbortController | null>(null)
  const previewRef = useRef<string | null>(null)

  const releasePreview = useCallback(() => {
    if (previewRef.current !== null) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    releasePreview()
    cancelRef.current?.abort()
    cancelRef.current = null
    setState(IDLE)
  }, [releasePreview])

  const cancel = useCallback(() => {
    cancelRef.current?.abort()
    cancelRef.current = null
    setState((current) => ({ ...current, stage: 'cancelled', error: 'Cancelled.' }))
  }, [])

  const process = useCallback(
    async (blob: Blob, filename: string | null): Promise<void> => {
      // A new paste/drop replaces any in-flight job so a second image cannot
      // race the first and leave the UI looking like nothing happened.
      cancelRef.current?.abort()
      const controller = new AbortController()
      cancelRef.current = controller

      releasePreview()
      const previewUrl = URL.createObjectURL(blob)
      previewRef.current = previewUrl

      setState({
        stage: 'validating',
        progress: 0,
        previewUrl,
        filename,
        error: null,
        outcome: null,
      })

      try {
        const validation = await validateImage(blob, { filename, measure: measureImageInBrowser })

        if (!validation.ok) {
          setState((current) => ({ ...current, stage: 'error', error: validation.message }))
          return
        }
        if (controller.signal.aborted) return

        const image: ValidatedImage = validation.image
        setState((current) => ({ ...current, stage: 'hashing', filename: image.filename }))

        // A re-paste of the same image is recognised before any work is done.
        const duplicate = await repository.findScreenshotByHash(image.fileHash)
        if (duplicate !== null) {
          const outcome: ImportOutcome = {
            screenshotId: duplicate.id,
            decision: 'DUPLICATE_IGNORED',
            reason: 'This exact screenshot has already been imported.',
            customerId: null,
            customerName: null,
            changes: [],
            followUpDueAt: null,
            requiresReview: false,
            undoable: false,
          }

          setState((current) => ({ ...current, stage: 'done', outcome }))
          notify('info', 'Already imported — nothing to do.')
          return
        }

        if (controller.signal.aborted) return
        setState((current) => ({ ...current, stage: 'extracting', progress: 0.05 }))

        const provider =
          mode === 'demo'
            ? createFixtureExtractionProvider({
                scenarioId: options.scenarioId ?? null,
                delayMs: 300,
                onProgress: (progress) => setState((current) => ({ ...current, progress })),
              })
            : createTesseractExtractionProvider({
                signal: controller.signal,
                onProgress: (progress) => setState((current) => ({ ...current, progress })),
              })

        const extracted = await provider.extract({
          image: image.blob,
          fileHash: image.fileHash,
          languageHint: settings.timeZone.includes('Mexico') ? 'spa' : 'eng',
        })

        if (controller.signal.aborted) return

        // OCR is free and on-device, but the job is still metered so the cost
        // page reports measured usage rather than an estimate.
        await repository.recordUsage('ocr_job', 1, 0)

        if (!extracted.ok) {
          setState((current) => ({ ...current, stage: 'error', error: extracted.error.message }))
          return
        }

        setState((current) => ({ ...current, stage: 'deciding', progress: 1 }))

        const parsed = parseUntrustedOcr(extracted.value.rawText)
        const extraction = parsed.ok ? parsed.value : null

        const decision = decideImport({
          // An invalid parse still needs a shape to reason about; the engine
          // reads extractionValid, not the placeholder.
          extraction: extraction ?? emptyExtraction(),
          customers: snapshot?.customers ?? [],
          isDuplicateHash: false,
          extractionValid: parsed.ok,
        })

        if (controller.signal.aborted) return
        setState((current) => ({ ...current, stage: 'applying' }))

        const outcome = await run((repo) =>
          repo.applyScreenshotImport({
            screenshot: {
              fileHash: image.fileHash,
              mimeType: image.mimeType,
              byteSize: image.byteSize,
              imageWidth: image.width,
              imageHeight: image.height,
              originalFilename: image.filename,
            },
            rawText: readUntrusted(extracted.value.rawText),
            extractionProvider: provider.info.id,
            extraction,
            decision: decision.decision,
            decisionReason: decision.reason,
            targetCustomerId: decision.targetCustomer?.id ?? null,
            candidates: decision.candidates,
            unverifiedFields: decision.unverifiedFields,
            warnings: decision.warnings,
            // Retention is opt-in; by default only the hash survives.
            retainImage: snapshot?.profile.retainScreenshots ?? false,
          }),
        )

        setState((current) => ({ ...current, stage: 'done', outcome }))

        if (outcome.requiresReview) {
          notify('info', `Needs review: ${outcome.reason}`)
        } else {
          notify('success', `Imported ${outcome.customerName ?? 'screenshot'}.`)
        }
      } catch (cause) {
        setState((current) => ({
          ...current,
          stage: 'error',
          error: cause instanceof Error ? cause.message : 'Could not process that screenshot.',
        }))
      } finally {
        cancelRef.current = null
      }
    },
    [mode, notify, options.scenarioId, releasePreview, repository, run, settings.timeZone, snapshot],
  )

  return { state, process, cancel, reset }
}
