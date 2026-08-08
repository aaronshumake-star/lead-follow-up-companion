import { describe, expect, it } from 'vitest'
import headers from '../../../public/_headers?raw'

/**
 * Tesseract.js boots a blob worker that importScripts() worker.min.js and the
 * WASM glue from jsDelivr, then compiles WASM. If script-src omits either
 * https://cdn.jsdelivr.net or 'wasm-unsafe-eval', production OCR rejects with
 * a bare string (not an Error) and the UI shows "The OCR engine failed to start."
 */
describe('OCR Content-Security-Policy', () => {
  const cspLine = headers
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('Content-Security-Policy:'))

  it('is declared for Cloudflare Pages static responses', () => {
    expect(cspLine).toBeDefined()
  })

  it('allows Tesseract CDN importScripts and WASM compilation', () => {
    expect(cspLine).toMatch(/script-src[^;]*'self'/)
    expect(cspLine).toMatch(/script-src[^;]*'wasm-unsafe-eval'/)
    expect(cspLine).toMatch(/script-src[^;]*https:\/\/cdn\.jsdelivr\.net/)
    expect(cspLine).toMatch(/worker-src[^;]*blob:/)
    expect(cspLine).toMatch(/connect-src[^;]*https:\/\/cdn\.jsdelivr\.net/)
  })
})
