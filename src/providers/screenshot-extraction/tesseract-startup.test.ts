import { describe, expect, it, vi } from 'vitest'
import { createTesseractExtractionProvider } from './tesseract.ts'

describe('createTesseractExtractionProvider startup failures', () => {
  it('maps a worker string rejection to the OCR startup error', async () => {
    vi.resetModules()
    vi.doMock('tesseract.js', () => ({
      recognize: vi.fn(async () => {
        // tesseract.js createWorker rejects worker.onerror with event.message
        // (a string), not an Error — that is what production CSP blocks produce.
        return Promise.reject('Script https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js load failed')
      }),
    }))

    const { createTesseractExtractionProvider: createFresh } = await import('./tesseract.ts')
    const provider = createFresh()
    const result = await provider.extract({
      image: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
      fileHash: 'a'.repeat(64),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toBe('The OCR engine failed to start.')
    }

    vi.doUnmock('tesseract.js')
    vi.resetModules()
  })

  it('keeps the createTesseractExtractionProvider export wired for production mode', () => {
    const provider = createTesseractExtractionProvider()
    expect(provider.info.id).toBe('tesseract')
    expect(provider.info.isBillable).toBe(false)
  })
})
